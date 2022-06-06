/*
    This file is part of XeniumFaucet.

    XeniumFaucet is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    XeniumFaucet is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with XeniumFaucet.  If not, see <https://www.gnu.org/licenses/>.
*/

const { WalletAPI } = require('turtlecoin-rpc')
const PackageJSON = require('./package.json')
const { terminal } = require('terminal-kit')
const request = require('request-promise')
const NeDB = require('nedb-promises')
const Express = require('express')
const config = require('./config')
const Path = require('path')

const HASH_UNITS = ['H', 'KH', 'MH', 'GH', 'TH', 'PH'];

const app = Express()

const addressesDatabase = NeDB.create({
	autoload: true,
	filename: config.databases.addresses
})

const transactionsDatabase = NeDB.create({
	autoload: true,
	filename: config.databases.transactions
})

const wallet = new WalletAPI({
	...config.wallet,
	userAgent: `XeniumFaucet ${PackageJSON.version}`
})

let walletAddress = ''
let status = {
	netHashrate: '0 H/s',
	walletBlocks: '0',
	networkBlocks: '0',
	peers: '0',
	totalBalance: '0',
	unlockedBalance: '0',
	lockedBalance: '0',
	totalTransactionsSent: '0',
	totalCoinsSent: '0'
}

async function main() {
	try {
		if (config.wallet.openWallet) {
			await wallet.open(
				config.wallet.walletToOpen.filename,
				config.wallet.walletToOpen.password,
				config.wallet.walletToOpen.daemon.host,
				config.wallet.walletToOpen.daemon.port
			)
		}

		walletAddress = await wallet.primaryAddress()

		terminal.blue(`Address: ${walletAddress}\n`)
		terminal.green(`${new Array(81).join('-')}\n`)

		await getWalletStatus()

		setInterval(getWalletStatus, 10000)

		app.listen(config.faucet.port, () => terminal.green(`Faucet listening on port ${config.faucet.port}\n`))
	} catch (error) {
		terminal.red(`${error.message}\n`)
	}
}

app.set('views', Path.join(__dirname, 'views'))
app.set('view engine', 'pug')

app.use(require('body-parser').json())
app.use(
	require('body-parser').urlencoded({
		extended: true
	})
)
app.use('/src', Express.static('src'))

app.use((_req, res, next) => {
	res.locals = {
		coinName: config.frontend.coinName,
		ticker: config.frontend.ticker,

		faucetOwner: config.frontend.faucetOwner,
		faucetOwnerDiscord: config.frontend.faucetOwnerDiscord,
		minCoins: prettyAmounts(config.faucet.minimumCoinsToBeSent / config.wallet.decimalDivisor),
		maxCoins: prettyAmounts(config.faucet.maximumCoinsToBeSent / config.wallet.decimalDivisor),
		decimalDivisor: config.wallet.decimalDivisor,
		claimableEvery: config.frontend.claimableEvery,

		faucetAddress: walletAddress,
		status: status,

		recaptchaEnabled: config.recaptcha.enabled,
		recaptchaSiteKey: config.recaptcha.siteKey,

		versionString: PackageJSON.version
	}

	next()
})

app.get('/', (_req, res) =>
	res.render('index', {
		locals: res.locals,
		coinWalletDescription: `Your ${res.locals.coinName} Wallet Address`,
		status
	})
)

app.get('/about', (_req, res) =>
	res.render('about', {
		locals: res.locals,
		status
	})
)

app.post('/claimCoins', async (req, res) => {
	const validationResult = validateClaimRequest(req)

	if (validationResult !== '') {
		return res.render('noAddressSpecified', {
			locals: res.locals,
			status,
			reason: validationResult
		})
	}

	try {
		if (config.recaptcha.enabled) {
			terminal.grey(`Trying to authenticate address ${req.body.address} using reCaptcha... `)

			let recaptchaResponse = await request({
				method: 'POST',
				uri: 'https://www.google.com/recaptcha/api/siteverify',
				qs: {
					secret: config.recaptcha.secretKey,
					response: req.body['g-recaptcha-response']
				}
			})

			recaptchaResponse = JSON.parse(recaptchaResponse)

			if (!recaptchaResponse.success) {
				terminal.red(`failed\n`)

				throw new Error(
					'Your Captcha is invalid. Please try again later. This might also mean that you are a bot.'
				)
			} else {
				terminal.green(`success\n`)
			}
		}

		const doc = await addressesDatabase.findOne({
			address: req.body.address
		})

		const balance = await wallet.balance()
		const atomicsToSend = generateRawCoinsToSend(config.faucet.minimumCoinsToBeSent, config.faucet.maximumCoinsToBeSent);

		if (balance.unlocked < config.faucet.minimumCoinsToBeSent / config.wallet.decimalDivisor) {
			return res.render('notEnoughBalance', {
				locals: res.locals,
				status,
				wouldSendCoins: prettyAmounts(atomicsToSend / res.locals.decimalDivisor)
			})
		}

		if (doc && doc.lastTime + config.faucet.claimableEvery < Date.now()) {
			console.log(
				`Address ${req.body.address} already claimed coins in the last ${config.faucet.claimableEvery} seconds.`
			)

			return res.render('coinsAlreadyClaimed', {
				locals: res.locals,
				status
			})
		}

		await updateOrInsertAddress(doc, req.body.address)

		terminal.blue(
			`Sending ${prettyAmounts(atomicsToSend / res.locals.decimalDivisor)} ${res.locals.ticker} to ${
				req.body.address
			}...`
		)

		const txHash = await wallet.sendAdvanced([
			{
				address: req.body.address,
				amount: atomicsToSend
			}
		])

		terminal.blue(`Sent! Hash: ${txHash}\n`)

		res.render('coinsSent', {
			locals: res.locals,
			status,
			amount: prettyAmounts(atomicsToSend / res.locals.decimalDivisor),
			txHash
		})

		await transactionsDatabase.insert({
			address: req.body.address,
			amount: atomicsToSend / res.locals.decimalDivisor,
			hash: txHash
		})
	} catch (err) {
		if (
			err.message ===
			'Your Captcha is invalid. Please try again later. This might also mean that you are a bot.'
		) {
			return
		}

		console.log(err)

		res.render('error', {
			locals: res.locals,
			status,
			error: err
		})
	}
})

app.get('/cooldowns', async (_req, res) => {
	const docs = await addressesDatabase.find()
	const cooldowns = docs
		.filter((doc) => doc.address)
		.map((doc) => ({
			address: `${doc.address.substring(0, 50)}...`,
			lastTime: new Date(doc.lastTime + config.faucet.claimableEvery).toUTCString()
		}))

	res.render('cooldowns', {
		locals: res.locals,
		status,
		cooldowns
	})
})

app.get('/admin', async (req, res) => {
	const addresses = await addressesDatabase.find()
	const transactions = await transactionsDatabase.find()

	res.render('admin', {
		locals: res.locals,
		status,
		addresses,
		transactions
	})
})

function getReadableHashRateString(hashrate, decimals = 2) {
	let i = 0

	while (hashrate > 1000) {
		hashrate = hashrate / 1000
		i++
	}

	return `${parseFloat(hashrate).toFixed(decimals)} ${HASH_UNITS[i]}/s`
}

async function getWalletStatus() {
	try {
		const stats = await wallet.status()
		terminal
			.green('|')
			.yellow(` Hashrate         : ${getReadableHashRateString(stats.hashrate, 2)}\n`)
			.green('|')
			.yellow(
				` Sync status      : ${stats.walletBlockCount}/${stats.networkBlockCount} (${(
					(stats.walletBlockCount * 100) /
					stats.networkBlockCount
				).toFixed(2)}%)\n`
			)
			.green('|')
			.yellow(` Peers            : ${stats.peerCount}\n`)


		const balance = await wallet.balance()

		terminal
			.green('|')
			.yellow(
				` Total            : ${prettyAmounts(balance.unlocked + balance.locked)} ${config.frontend.ticker}\n`
			)
			.green('|')
			.yellow(` Unlocked         : ${prettyAmounts(balance.unlocked)} ${config.frontend.ticker}\n`)
			.green('|')
			.yellow(` Locked           : ${prettyAmounts(balance.locked)} ${config.frontend.ticker}\n`)

		const addresses = await addressesDatabase.find()
		terminal.green('|').yellow(` Addresses known  : ${addresses.length}\n`)

		const txs = await transactionsDatabase.find()

		const totalSent = txs.reduce((acc, tx) => acc + tx.amount, 0)

		terminal
			.green('|')
			.yellow(` Total Txs Sent   : ${txs.length}\n`)
			.green('|')
			.yellow(` Total Coins Sent : ${prettyAmounts(totalSent)} ${config.frontend.ticker}\n`)
			.green(new Array(81).join('-') + '\n')

		status = {
			netHashrate: getReadableHashRateString(stats.hashrate, 2),
			walletBlocks: stats.walletBlockCount.toLocaleString('en-US'),
			networkBlocks: stats.networkBlockCount.toLocaleString('en-US'),
			peers: stats.peerCount.toLocaleString('en-US'),
			totalBalance: prettyAmounts(balance.unlocked + balance.locked),
			unlockedBalance: prettyAmounts(balance.unlocked),
			lockedBalance: prettyAmounts(balance.locked),
			addressesKnown: addresses.length.toLocaleString('en-US'),
			totalTransactionsSent: txs.length.toLocaleString('en-US'),
			totalCoinsSent: prettyAmounts(totalSent),
		};
	} catch (err) {
		terminal.red(`An error occurred whilst updating the wallet status: ${err.message}\n`)
	}
}

function prettyAmounts(amount) {
	const { decimalPlaces } = config.wallet

	let i = parseInt((amount = Math.abs(Number(amount || 0)).toFixed(decimalPlaces))).toString()
	let j = i.length > 3 ? i.length % 3 : 0

	return (
		(j ? i.substring(0, j) + ',' : '') +
		i.substring(j).replace(/(\d{3})(?=\d)/g, '$1,') +
		(decimalPlaces
			? '.' +
			  Math.abs(amount - i)
					.toFixed(decimalPlaces)
					.slice(2)
			: '')
	)
}

function validateClaimRequest(req) {
	if (!req.body) {
		return 'The body you sent is empty.'
	}

	if (!req.body.address) {
		return 'You have not put in a wallet address.'
	}

	if (req.body.address.length !== config.faucet.walletAddressLength) {
		return `The address you put in is not ${config.faucet.walletAddressLength} characters long.`
	}

	if (!req.body.address.startsWith(config.faucet.walletAddressStartsWith)) {
		return `The address you put in does not begin with ${config.faucet.walletAddressStartsWith}.`
	}

	if (req.body.address === walletAddress) {
		return 'The address you put in is the faucet\'s wallet address.'
	}

	return ''
}

async function updateOrInsertAddress(doc, address) {
	if (!doc) {
		console.log(`Address ${address} not found in DB, inserting...`)

		await addressesDatabase.insert({
			address,
			lastTime: Date.now()
		})

		return
	}

	console.log(`Address ${address} found in DB, updating...`)

	await addressesDatabase.update(
		{ address },
		{ lastTime: Date.now() }
	)
}

/**
 * @param {number} min Minimum amount in decimals
 * @param {number} max Maximum amount in decimals
 * @returns {number} Random amount in decimals
 */
function generateRawCoinsToSend(min, max) {
	const variance = max - min;
	const rawCoinsToSend = Math.random() * variance + min;

	return Math.floor(rawCoinsToSend);
}

main();

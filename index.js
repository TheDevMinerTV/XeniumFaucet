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
let status = {}

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
	} catch (error) {
		terminal.red(`${e.message}\n`)
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
		minCoins: prettyAmounts(config.faucet.minimumCoinsToBeSent),
		maxCoins: prettyAmounts(config.faucet.maximumCoinsToBeSent),
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

	const validationResult = validateClaimRequest(req)

	if (!validationResult) {
		return res.render('noAddressSpecified', {
			locals: res.locals,
			status,
			reason: validationResult
		})
	}

	new Promise((resolve) => resolve())
		.then(async () => {
			if (config.recaptcha.enabled) {
				terminal.grey(`Trying to authenticate address ${req.body.address} using reCaptcha... `)

				let body = await request({
					method: 'POST',
					uri: 'https://www.google.com/recaptcha/api/siteverify',
					qs: {
						secret: config.recaptcha.secretKey,
						response: req.body['g-recaptcha-response']
					}
				})

				body = JSON.parse(body)

				if (!body.success) {
					terminal.red(`failed\n`)
					throw new Error(
						'Your Captcha is invalid. Please try again later. This might also mean that you are a bot.'
					)
				} else {
					terminal.green(`success\n`)
				}
			}
		})
		.then(() =>
			addressesDatabase.findOne({
				address: req.body.address
			})
		)
		.then(async (doc) => {
			let txHash

			const balance = await wallet.balance()

			let coinsToBeSent =
				(Math.floor(
					Math.random() * (config.faucet.maximumCoinsToBeSent - config.faucet.minimumCoinsToBeSent)
				) +
					config.faucet.minimumCoinsToBeSent) *
				res.locals.decimalDivisor

			if (balance.unlocked < config.faucet.minimumCoinsToBeSent) {
				return res.render('notEnoughBalance', {
					locals: res.locals,
				status,
					wouldSendCoins: prettyAmounts(coinsToBeSent / res.locals.decimalDivisor)
				})
			}

			if (doc && doc.lastTime > Date.now() - config.faucet.claimableEvery) {
				console.log(
					`Address ${req.body.address} already claimed coins in the last ${config.faucet.claimableEvery} seconds.`
				)

				return res.render('coinsAlreadyClaimed', {
					locals: res.locals,
				status
				})
			}

			terminal.blue(
				`Sending ${prettyAmounts(coinsToBeSent / res.locals.decimalDivisor)} ${res.locals.ticker} to ${
					req.body.address
				}...`
			)

			return wallet.sendAdvanced([
				{
					address: req.body.address,
					amount: coinsToBeSent
				}
			])
		})
		.then((hash) => {
			txHash = hash
			terminal.blue(`Sent! Hash: ${txHash}\n`)

			res.render('coinsSent', {
				locals: res.locals,
			status,
				amount: prettyAmounts(coinsToBeSent / res.locals.decimalDivisor),
			txHash
			})
		})
		.then(() => {
			transactionsDatabase.insert({
				address: req.body.address,
				amount: coinsToBeSent / res.locals.decimalDivisor,
				hash: txHash
			})

			if (!doc) {
				console.log(`Address ${req.body.address} not found in DB, inserting...`)

				addressesDatabase.insert({
					address: req.body.address,
					lastTime: Date.now()
				})
			} else {
				console.log(`Address ${req.body.address} found in DB, updating...`)

				addressesDatabase.update(
					{
						address: req.body.address
					},
					{
						lastTime: Date.now()
					}
				)
			}
		})
		.catch((err) => {
			if (
				err.message ===
				'Your Captcha is invalid. Please try again later. This might also mean that you are a bot.'
			)
				return

			console.log(err)

			res.render('error', {
				locals: res.locals,
			status,
				error: err
			})
		})
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

app.listen(config.faucet.port, () => terminal.green(`Faucet listening on port ${config.faucet.port}\n`))

async function getWalletStatus() {
	try {
		const stats = await wallet.status()
			terminal
				.green('|')
				.yellow(` Hashrate         : ${(stats.hashrate / 1000).toFixed(2)} kH/s\n`)
				.green('|')
				.yellow(
					` Sync status      : ${stats.walletBlockCount}/${stats.networkBlockCount} (${(
						(stats.walletBlockCount * 100) /
						stats.networkBlockCount
					).toFixed(2)}%)\n`
				)
				.green('|')
				.yellow(` Peers            : ${stats.peerCount}\n`)

			status = {
				netHashrate: (stats.hashrate / 1000).toFixed(2),
				walletBlocks: stats.walletBlockCount,
				networkBlocks: stats.networkBlockCount,
				peers: stats.peerCount
			}

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

			status.totalBalance = prettyAmounts(balance.unlocked + balance.locked)
			status.unlockedBalance = prettyAmounts(balance.unlocked)
			status.lockedBalance = prettyAmounts(balance.locked)

		const addresses = await addressesDatabase.find()
			terminal.green('|').yellow(` Addresses known  : ${addresses.length}\n`)

			status.addressesKnown = addresses.length

		const txs = await transactionsDatabase.find()

			let totalSent = 0

			txs.forEach((tx) => (totalSent += tx.amount))

			terminal
				.green('|')
				.yellow(` Total Txs Sent   : ${txs.length}\n`)
				.green('|')
				.yellow(` Total Coins Sent : ${prettyAmounts(totalSent)} ${config.frontend.ticker}\n`)
				.green(new Array(81).join('-') + '\n')

			status.totalTransactionsSent = txs.length
			status.totalCoinsSent = prettyAmounts(totalSent)
	} catch (err) {
		terminal.red(`An error occurred whilst updating the wallet status: ${err.message}\n`)
	}
}

function prettyAmounts(amount) {
	let decimalPlaces = config.wallet.decimalPlaces

	let i = parseInt((amount = Math.abs(Number(amount || 0)).toFixed(decimalPlaces))).toString(),
		j = i.length > 3 ? i.length % 3 : 0

	return (
		(j ? i.substr(0, j) + ',' : '') +
		i.substr(j).replace(/(\d{3})(?=\d)/g, '$1,') +
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
		return "The address you put in is the faucet's wallet address."
	}

	return ''
}

async function updateOrInsertAddress(address) {
	if (!doc) {
		console.log(`Address ${address} not found in DB, inserting...`)

		await addressesDatabase.insert({
			address,
			lastTime: Date.now()
		})
	} else {
		console.log(`Address ${address} found in DB, updating...`)

		await addressesDatabase.update(
			{
				address
			},
			{
				lastTime: Date.now()
			}
		)
	}
}

main()

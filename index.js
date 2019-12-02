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
const { terminal } = require('terminal-kit')
const app = require('express')()

const config = require('./config')

const addressesDatabase = require('nedb-promises').create({ autoload: true, filename: config.databases.addresses }),
	transactionsDatabase = require('nedb-promises').create({ autoload: true, filename: config.databases.transactions }),
	wallet = new WalletAPI({ ...config.wallet, userAgent: `XeniumFaucet ${require('./package.json').version}` })

let walletAddress = '',
	status = {}

new Promise(resolve => resolve())
	.then(() => {
		if (config.wallet.openWallet) {
			return wallet.open(
				config.wallet.walletToOpen.filename,
				config.wallet.walletToOpen.password,
				config.wallet.walletToOpen.daemon.host,
				config.wallet.walletToOpen.daemon.port
			)
		} else {
			return new Promise(resolve => resolve())
		}
	})
	.then(() => wallet.primaryAddress())
	.then((address) => walletAddress = address)
	.then(() => terminal.blue(`Address: ${walletAddress}\n`))
	.then(() => terminal.green(new Array(81).join('-') + '\n'))
	.then(() => getWalletStatus())
	.then(() => setInterval(getWalletStatus, 10000))
	.catch((e) => terminal.red(e.message + '\n'))

app.set('views', __dirname + '/views')
app.set('view engine', 'pug')

app.use(require('body-parser').json())
app.use(require('body-parser').urlencoded({
	extended: true
}))

app.use((req, res, next) => {
	res.locals = {
		coinName: config.frontend.coinName,
		ticker: config.frontend.ticker,

		faucetOwner: config.frontend.faucetOwner,
		minCoins: prettyAmounts(config.faucet.minimumCoinsToBeSent),
		maxCoins: prettyAmounts(config.faucet.maximumCoinsToBeSent),
		decimalDivisor: config.wallet.decimalDivisor,
		claimableEvery: config.frontend.claimableEvery,

		faucetAddress: walletAddress,
		status: status,

		versionString: require('./package.json').version
	}

	next()
})

app.get('/', (req, res) => res.render('index', {
	locals: res.locals,
	coinWalletDescription: `Your ${res.locals.coinName} Wallet Address`,
	status: status
}))

app.get('/about', (req, res) => res.render('about', {
	locals: res.locals,
	status: status
}))

app.post('/claimCoins', (req, res) => {
	if (!req.body) {
		return res.render('noAddressSpecified', {
			locals: res.locals,
			status: status
		})
	} else if (!req.body.address) {
		return res.render('noAddressSpecified', {
			locals: res.locals,
			status: status,
			reason: 'You have not put in a wallet address.'
		})
	} else if (req.body.address.length !== config.faucet.walletAddressLength) {
		return res.render('noAddressSpecified', {
			locals: res.locals,
			status: status,
			reason: `The address you put in is not ${config.faucet.walletAddressLength} characters long.`
		})
	} else if (!req.body.address.startsWith(config.faucet.walletAddressStartsWith)) {
		return res.render('noAddressSpecified', {
			locals: res.locals,
			status: status,
			reason: `The address you put in does not begin with ${config.faucet.walletAddressStartsWith}.`
		})
	} else if (req.body.address === walletAddress) {
		return res.render('noAddressSpecified', {
			locals: res.locals,
			status: status,
			reason: 'The address you put in is the faucet\'s wallet address.'
		})
	}

	addressesDatabase.findOne({
		address: req.body.address
	})
		.then(async (doc) => {
			let txHash

			const balance = await wallet.balance()

			let coinsToBeSent = (Math.floor(Math.random() * (config.faucet.maximumCoinsToBeSent - config.faucet.minimumCoinsToBeSent)) + config.faucet.minimumCoinsToBeSent) * res.locals.decimalDivisor

			if (balance.unlocked < config.faucet.minimumCoinsToBeSent) {
				return res.render('notEnoughBalance', {
					locals: res.locals,
					status: status,
					wouldSendCoins: prettyAmounts(coinsToBeSent / res.locals.decimalDivisor)
				})
			}

			if (!doc) {
				addressesDatabase.insert({
					address: req.body.address,
					lastTime: Date.now()
				})
			} else if (doc.lastTime > (Date.now() - config.faucet.claimableEvery)) {
				return res.render('coinsAlreadyClaimed', {
					locals: res.locals,
					status: status
				})
			} else {
				addressesDatabase.update({
					_id: doc._id
				}, {
					lastTime: Date.now()
				})
			}


			terminal.blue(`Sending ${prettyAmounts(coinsToBeSent / res.locals.decimalDivisor)} ${res.locals.ticker} to ${req.body.address}...`)

			wallet.sendAdvanced([
				{
					address: req.body.address,
					amount: coinsToBeSent
				}
			])
				.then((hash) => {
					txHash = hash
					terminal.blue(`Sent! Hash: ${txHash}\n`)

					res.render('coinsSent', {
						locals: res.locals,
						status: status,
						amount: prettyAmounts(coinsToBeSent / res.locals.decimalDivisor),
						txHash: txHash
					})
				})
				.then(() => transactionsDatabase.insert({
					address: req.body.address,
					amount: coinsToBeSent / res.locals.decimalDivisor,
					hash: txHash
				}))
				.catch((err) => {
					console.log(err)

					res.render('error', {
						locals: res.locals,
						status: status,
						error: err
					})
				})
		})
})

app.get('/cooldowns', (req, res) => {
	addressesDatabase.find()
		.then((docs) => {
			const cooldowns = []

			docs.forEach((doc) => {
				cooldowns.push({
					address: doc.address.substring(0, 50) + '...',
					lastTime: new Date(doc.lastTime + config.faucet.claimableEvery).toUTCString()
				})
			})

			res.render('cooldowns', {
				locals: res.locals,
				status: status,
				cooldowns: cooldowns
			})
		})
})

app.listen(config.faucet.port, () => terminal.green(`Faucet listening on port ${config.faucet.port}\n`))

function getWalletStatus() {
	wallet.status()
		.then((stats) => {
			terminal
				.green('|').yellow(` Hashrate         : ${(stats.hashrate / 1000).toFixed(2)} kH/s\n`)
				.green('|').yellow(` Sync status      : ${stats.walletBlockCount}/${stats.networkBlockCount} (${(stats.walletBlockCount * 100 / stats.networkBlockCount).toFixed(2)}%)\n`)
				.green('|').yellow(` Peers            : ${stats.peerCount}\n`)

			status = {
				netHashrate: (stats.hashrate / 1000).toFixed(2),
				walletBlocks: stats.walletBlockCount,
				networkBlocks: stats.networkBlockCount,
				peers: stats.peerCount
			}
		})
		.then(() => wallet.balance())
		.then((balance) => {
			terminal
				.green('|').yellow(` Total            : ${prettyAmounts(balance.unlocked + balance.locked)} ${config.frontend.ticker}\n`)
				.green('|').yellow(` Unlocked         : ${prettyAmounts(balance.unlocked)} ${config.frontend.ticker}\n`)
				.green('|').yellow(` Locked           : ${prettyAmounts(balance.locked)} ${config.frontend.ticker}\n`)

			status.totalBalance = prettyAmounts(balance.unlocked + balance.locked)
			status.unlockedBalance = prettyAmounts(balance.unlocked)
			status.lockedBalance = prettyAmounts(balance.locked)
		})
		.then(() => addressesDatabase.find())
		.then((addresses) => {
			terminal
				.green('|').yellow(` Addresses known  : ${addresses.length}\n`)

			status.addressesKnown = addresses.length
		})
		.then(() => transactionsDatabase.find())
		.then((txs) => {
			let totalSent = 0

			txs.forEach((tx) => totalSent += tx.amount)

			terminal
				.green('|').yellow(` Total Txs Sent   : ${txs.length}\n`)
				.green('|').yellow(` Total Coins Sent : ${prettyAmounts(totalSent)} ${config.frontend.ticker}\n`)
				.green(new Array(81).join('-') + '\n')

			status.totalTransactionsSent = txs.length
			status.totalCoinsSent = prettyAmounts(totalSent)
		})
		.catch((e) => terminal.red(e.message + '\n'))
}

function prettyAmounts(amount) {
	let decimalPlaces = config.wallet.decimalPlaces

	let i = parseInt(amount = Math.abs(Number(amount || 0)).toFixed(decimalPlaces)).toString(),
			j = (i.length > 3) ? i.length % 3 : 0

	return (j ? i.substr(0, j) + ',' : '') + i.substr(j).replace(/(\d{3})(?=\d)/g, "$1,") + (decimalPlaces ? '.' + Math.abs(amount - i).toFixed(decimalPlaces).slice(2) : '')
}

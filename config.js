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

module.exports = {
	// Filenames for the databases
	databases: {
		transactions: 'transactions.db',
		addresses: 'addresses.db'
	},

	// WalletAPI configuration
	wallet: {
		// Set openWallet to true if it should open the wallet configured
		openWallet: false,

		// The wallet to open
		walletToOpen: {
			filename: 'faucet',
			password: 'faucet',
			daemon: {
				host: '127.0.0.1',
				port: 32779
			}
		},

		// The server the wallet API is running on
		host: '127.0.0.1',
		port: 32780,

		// Password for the wallet API
		password: 'faucet',

		// Coin configuration
		defaultUnlockTime: 35,
		defaultMixin: 2,
		decimalPlaces: 3,
		decimalDivisor: 10 ** 3, // 10 to the power of decimalPlaces
		defaultFee: 0.5
	},

	// Google reCaptcha v2 configuration
	recaptcha: {
		// Set to true if reCaptcha should be enabled
		enabled: false,

		// Credentials from reCaptcha's Admin Console
		siteKey: 'YOUR SITEKEY',
		secretKey: 'YOUR SECRETKEY'
	},

	// Backend configuration
	faucet: {
		// The port where the faucet should run on
		port: 8909,

		// The minimum amount of coins to be sent (in decimals)
		minimumCoinsToBeSent: 1000,

		// The maximum amount of coins to be sent (in decimals)
		maximumCoinsToBeSent: 25000,

		// Address validation
		walletAddressLength: 98,
		walletAddressStartsWith: 'XNU',

		// Coins are claimable every this many seconds
		claimableEvery: 24 * 60 * 60 * 1000 // 24 hours
	},

	// Frontend configuration
	frontend: {
		// Coin configuration for the frontend
		coinName: 'Xenium',
		ticker: 'XNU',

		// Coin claiming interval as a string
		claimableEvery: '24 hours',

		// The person this faucet is run by, with Discord Tag
		faucetOwner: 'TheDevMinerTV',
		faucetOwnerDiscord: 'TheDevMinerTV#4751'
	}
}

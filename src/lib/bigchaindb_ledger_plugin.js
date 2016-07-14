import co from 'co';
import reconnectCore from 'reconnect-core';
import EventEmitter2 from 'eventemitter2';
import SimpleWebsocket from 'simple-websocket';

import request from '../util/request';

class BigchainDBLedgerPlugin extends EventEmitter2 {

    constructor(options) {
        super();

        this.id = options.ledgerId;
        this.credentials = options.auth;
        this.config = options.config;

        this.connection = null;
        this.connected = false;
    }

    connect() {
        return co(this._connect.bind(this));
    }

    * _connect() {
        const wsUri = this.credentials.account.uri.ws;

        if (this.connection) {
            console.warn('already connected, ignoring connection request');
            return Promise.resolve(null);
        }

        const streamUri = `${wsUri}/changes`;
        console.log(`subscribing to ${streamUri}`);

        const reconnect = reconnectCore(() => new SimpleWebsocket(streamUri));

        return new Promise((resolve, reject) => {
            this.connection = reconnect({immediate: true}, (ws) => {
                ws.on('open', () => {
                    console.log(`ws connected to ${streamUri}`);
                });
                ws.on('data', (msg) => {
                    const notification = JSON.parse(msg);
                    co.wrap(this._handleNotification)
                        .call(this, notification)
                        .catch((err) => {
                            console.error(err);
                        });
                });
                ws.on('close', () => {
                    console.log(`ws disconnected from ${streamUri}`);
                });
            })
                .once('connect', () => resolve(null))
                .on('connect', () => {
                    this.connected = true;
                    this.emit('connect');
                })
                .on('disconnect', () => {
                    this.connected = false;
                    this.emit('disconnect');
                })
                .on('error', (err) => {
                    console.warn(`ws error on ${streamUri}:  ${err}`);
                    reject(err);
                })
                .connect();
        });
    }

    disconnect() {
        if (this.connection) {
            this.connection.disconnect();
            this.connection = null;
        }
    }

    isConnected() {
        return this.connected;
    }

    getInfo() {
    }

    getAccount() {
        return this.credentials.account;
    }

    getBalance() {
        return co.wrap(this._getBalance).call(this);
    }

    * _getBalance() {
        const {
            account
        } = this.credentials;

        let res;

        try {
            res = yield request(`${account.uri.api}accounts/${account.id}/assets/`);
        } catch (e) {
            throw new Error('Unable to determine current balance');
        }

        if (res && res.assets && res.assets.bigchain && res.assets.bigchain.length) {
            return res.assets.bigchain.length;
        } else {
            throw new Error('Unable to determine current balance');
        }
    }


    getConnectors() {
        return co.wrap(this._getConnectors).call(this);
    }

    * _getConnectors() {
        if (this.id === undefined) {
            throw new Error('Must be connected before getConnectors can be called');
        }

        const {
            account
        } = this.credentials;

        let res;
        try {
            res = yield request(`${account.uri.api}/api/ledgers/${this.id}/connectors/`, {
                method: 'GET',
                query: {
                    app: 'interledger'
                }
            });
        } catch (e) {
            console.error(e);
            throw new Error(`Unable to get connectors`);
        }
        return res;
    }

    /*
     Initiates a ledger-local transfer.
     */
    send(transfer) {
        return co.wrap(this._send).call(this, transfer);
    }

    * _send(transfer) {
        let res;

        const {
            account
        } = this.credentials;

        const {
            txid,
            cid
        } = transfer.asset;

        try {
            res = yield request(`${account.uri.api}/api/assets/${txid}/${cid}/escrow/`, {
                method: 'POST',
                jsonBody: {
                    source: {
                        vk: account.id,
                        sk: account.key
                    },
                    to: transfer.account,
                    ilpHeader: {
                        account: transfer.destinationAccount.vk,
                        ledger: transfer.destinationAccount.ledger.id
                    },
                    executionCondition: transfer.executionCondition,
                    expiresAt: transfer.expiresAt
                }
            });
        } catch (e) {
            throw new Error('Unable to escrow transfer');
        }
        return res;
    }

    fulfillCondition(transferID, conditionFulfillment) {
        return co.wrap(this._fulfillCondition).call(this, transferID, conditionFulfillment);
    }

    * _fulfillCondition(transfer, conditionFulfillment) {
        let res;

        const {
            account
        } = this.credentials;

        const {
            txid,
            cid
        } = transfer.asset;

        try {
            res = yield request(`${account.uri.api}/api/assets/${txid}/${cid}/escrow/fulfill/`, {
                method: 'POST',
                jsonBody: {
                    source: {
                        vk: account.id,
                        sk: account.key
                    },
                    to: transfer.account,
                    conditionFulfillment: conditionFulfillment
                }
            });
        } catch (e) {
            throw new Error('Unable to escrow transfer');
        }
        return res;
    }

    replyToTransfer() {
    }

    * _handleNotification(changes) {
        yield this.emitAsync('incoming', changes);
    }
}

export default BigchainDBLedgerPlugin;

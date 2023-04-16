'use strict';

var Service;
var Characteristic;
var net = require('net');
var clients = {};
var healthCheckTimeout = {};
var switchStates = {};
var responseCallback = function() {};


module.exports = function (homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    homebridge.registerAccessory('homebridge-tcpswitch', 'TcpSwitch', TcpSwitch);
};

class TcpSwitch {
    constructor (log, config) {
        this.log = log;

        this.name                = config.name || 'TcpSwitch';
        this.host                = config.host;
        this.port                = config.port || 6269;
        this.value               = config.value || 1
        switchStates[this.value] = false;
        this.clientKey           = this.host + ":" + this.port;
        //
        this.connect(true);

        this.service = new Service.Switch(this.name);
    }

    connect (init) {
        var $this = this;
        if (init === true) {
            if (this.clientKey in clients) {
                this.client = clients[this.clientKey];
                return;
            }
        }
        this.log('Connecting...');
        this.client = clients[this.clientKey] = net.createConnection({
            "port": this.port, 
            "host": this.host,
            "noDelay": true,
            "keepAlive": true
        }, function() {
            $this.log("Connected successfully");
        });
        this.client.on('data', function(data) {
            if (data[0] == 0x53) {
                $this.log("Initialization Message received");
                var dataString = data.toString();
                dataString = dataString.substr(dataString.indexOf("&f")+1);
                for (var i = 1; i < dataString.length && i < 13; i++){
                    switchStates[i] = (dataString[i] == '1');
                }
            } else {
                if ($this.clientKey in healthCheckTimeout && healthCheckTimeout[$this.clientKey] !== undefined) {
                    clearTimeout(healthCheckTimeout[$this.clientKey]);
                    healthCheckTimeout[$this.clientKey] = undefined;
                }
                responseCallback(data);
            }
        });
        if(init) {
            this.client.on('close', function(){
                $this.log('Connection closed. Reconnecting...');
                $this.connect();
            });
        }
    }

    tcpRequest (value, callback) {
        responseCallback = callback;
        var $this = this;
        // try {
        var arr = [];
        if (value < 10)
            arr = [0x72, 0x30 + value, 0x0a, 0x0a];
        else
            arr = [0x72, 0x31, 0x30 + value - 10, 0x0a, 0x0a];
        var result = this.client.write(new Uint8Array(arr));
        this.log("Command written: " + result);
        healthCheckTimeout[this.clientKey] = setTimeout(1000, function() {
            $this.log('No response received. Destroying connection...');
            $this.client.destroy();
        });
        // } catch (error) {
            // this.log('Error writing. Destroyin connection...');
            // this.client.destroy();
        // }
    }

    getServices () {
        const informationService = new Service.AccessoryInformation()
            .setCharacteristic(Characteristic.Manufacturer, 'TcpSwitch')
            .setCharacteristic(Characteristic.Model, 'TcpSwitch');

        this.service.getCharacteristic(Characteristic.On)
            .on('get', this.getOnCharacteristicHandler.bind(this))
            .on('set', this.setOnCharacteristicHandler.bind(this));

        return [informationService, this.service];
    }

    setOnCharacteristicHandler (value, callback) {
        this.tcpRequest(this.value, function(result){
            var switchValue = result[1] & 0x0F;
            var switchState = (result[2] & 0x0F) == 0x0e;
            switchStates[switchValue] = switchState;
            callback(null);
        });
    }

    getOnCharacteristicHandler (callback) {
        callback(null, switchStates[this.value]);
    }
}
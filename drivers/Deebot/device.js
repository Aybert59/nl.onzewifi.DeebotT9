'use strict';

const { Device } = require('homey');
const tools = require('../../lib/tools');
const ecovacsDeebot = require('ecovacs-deebot');
const EcoVacsAPI = ecovacsDeebot.EcoVacsAPI;
const SYNC_INTERVAL = 1000 * 60;  // 60 seconds

class VacuumDevice extends Device {

	async onInit() {

		this.log('Device ' + this.getName() + ' has been initialized');

		//this.registerCapabilityListener('onoff', this.onCapabilityOnoff.bind(this));
		this.registerCapabilityListener('AutoClean', this.onCapabilityAutoClean.bind(this));
		this.registerCapabilityListener('PauseCleaning', this.onCapabilityPauseCleaning.bind(this));
		this.registerCapabilityListener('ReturnDock', this.onCapabilityReturnDock.bind(this));
		this.registerCapabilityListener('AutoEmpty', this.onCapabilityAutoEmpty.bind(this));
		this.registerCapabilityListener('VacuumPower', this.onCapabilityVacuumPower.bind(this));
		this.registerCapabilityListener('CleanCount', this.onCapabilityCleanCount.bind(this));
		this.registerCapabilityListener('WaterFlowLevel', this.onCapabilityWaterFlowLevel.bind(this));
		this.registerCapabilityListener('ScrubbingType', this.onCapabilityScrubbingType.bind(this));
		this.registerCapabilityListener('AromaMode', this.onCapabilityAromaMode.bind(this));

		this.setStoreValue('flowTokens', []);

		const actionAutoClean = this.homey.flow.getActionCard('auto_clean');
		actionAutoClean.registerRunListener(async (args, state) => {
			this.vacbot.clean();
		});

		const actionSpotArea = this.homey.flow.getActionCard('spot_area');
		actionSpotArea.registerArgumentAutocompleteListener('zone', this.flowAutocompleteactionSpotArea.bind(this));
		actionSpotArea.registerRunListener(async (args, state) => {
			if (args.zone) {
				this.log('Clean zone: ' + args.zone.id);
				this.vacbot.spotArea(args.zone.id);
			}
		});

		const actionSpotAreas = this.homey.flow.getActionCard('spot_areas');
		actionSpotAreas.registerRunListener(async (args, state) => {
			if (args.zones) {
				var currentMap = this.getStoreValue('currentMap');
				let Zones = [];
				if (args.zones.includes('[')) {
					// Asume flowtokens are being user, but remove anything that is not in the [x:y] format
					let ZoneTokens = args.zones.match(/\[(.*?)\]/g);
					if (ZoneTokens) {
						ZoneTokens.forEach(ZoneToken => {
							let floorRoom = ZoneToken.split(':');
							let Floor = parseInt(floorRoom[0].replace(/[\[\]]/g, ""));
							let Zone = parseInt(floorRoom[1].replace(/[\[\]]/g, ""));
							if (!isNaN(Floor) && !isNaN(Zone)) { Zones.push({ Floor: Floor, Zone: Zone }); }
						});
					}
				} else {
					// Asume roomnumbers (seperated by a comma) are being used, but remove anything other then numbers and commas
					let Rooms = args.zones.replace(/\[.*?\]/g, '').replace(/\s/g, '').split(',');
					Rooms.forEach(Room => {
						if (/^\d+$/.test(Room)) {
							let Zone = parseInt(Room);
							if (!isNaN(Zone)) { Zones.push({ Floor: currentMap.mapIndex, Zone: Zone }); }
						}
					});
				}
				// If you want to filter rooms on the current floor, uncomment the line below
				// Zones = Zones.filter(Zone => Zone.Floor === currentMap.mapIndex);
				let CleaningZones = Zones.map(Zone => Zone.Zone).join(',');
				this.log('Clean zones: ' + CleaningZones);
				this.vacbot.spotArea(CleaningZones);
			}
		});

		const rechargeAction = this.homey.flow.getActionCard('return_dock');
		rechargeAction.registerRunListener(this.flowRechargeAction.bind(this));

		// let api = DeviceAPI;
		let api = global.DeviceAPI;
		if (api == null) {
			this.log('system reboot, reconnecting');
			this.driver.onRepair(null, this);
		} else {
			this.log('new device, do nothing else');
		}

		//const changeChannelCondition = this.homey.flow.getConditionCard('current_channel');
		//  changeChannelCondition.registerRunListener(this.flowCurrentChannel.bind(this));
	}

	async onAdded() {
		this.log('Vacuum has been added');
		this.log('Deebot name is ' + this.getName());

		let data = this.getData();
		let api = global.DeviceAPI;
		let init = true;

		let voidTable = [];
		this.setStoreValue('areas', voidTable);
		this.setStoreValue('mapnames', voidTable);

		// let app = this;

		this.log('Deebot ApiVersion : ', api.getVersion());
		this.vacbot = api.getVacBot(api.uid, EcoVacsAPI.REALM, api.resource, api.user_access_token, data.vacuum, data.geo);

		this.vacbot.on('ready', async (event) => {
			this.log('Deebot device is ready');
			this.setAvailable();
			this;//.syncStatus(this.vacbot);
			this.setSettings({
				username: data.username,
				password: data.password,
			});

			const changeChargeStateTrigger = this.homey.flow.getDeviceTriggerCard('charge_state_change');
			const changeOperationTrigger = this.homey.flow.getDeviceTriggerCard('operation_change');
			const changeZoneTrigger = this.homey.flow.getDeviceTriggerCard('zone_change');
			const cleanReportTrigger = this.homey.flow.getDeviceTriggerCard('clean_report');

			const CleanLogTriggerImage = await this.homey.images.createImage();
			CleanLogTriggerImage.setPath('/userdata/latestCleanLog_(' + data.id + ').png');

			this.vacbot.run('GetMaps');
			this.vacbot.run('GetWaterBoxInfo');
			this.vacbot.run('GetCleanCount');
			this.vacbot.run('GetCleanSpeed');
			this.vacbot.run('GetWaterLevel');
			this.vacbot.run('GetAutoEmpty');
			// this.vacbot.run('GetAromaMode'); Not working (yet?)
			this.vacbot.run('GetBatteryState');
			this.vacbot.run('GetCleanState');
			this.vacbot.run('GetCleanLogs');

			this.vacbot.on('WaterBoxInfo', (level) => {
				this.setCapabilityValue('MopStatus', Boolean(level));
			});

			this.vacbot.on('WaterBoxInfo', (level) => {
				this.setCapabilityValue('MopStatus', Boolean(level));
			});

			this.vacbot.on('CleanCount', (mode) => {
				this.setCapabilityValue('CleanCount', Boolean((mode - 1)));
			});

			this.vacbot.on('CleanSpeed', (level) => {
				this.setCapabilityValue('VacuumPower', level.toString());
			});

			this.vacbot.on('WaterLevel', (level) => {
				this.setCapabilityValue('WaterFlowLevel', level.toString());
			});

			this.vacbot.on('AutoEmpty', (mode) => {
				this.setCapabilityValue('AutoEmpty', Boolean(mode));
			});

			this.vacbot.on('AromaMode', (mode) => {
				this.setCapabilityValue('AromaMode', Boolean(mode));
			});

			this.vacbot.on("BatteryInfo", (battery) => {
				this.setCapabilityValue('measure_battery', Math.round(battery));
			});

			this.vacbot.on('WaterBoxScrubbingType', (mode) => {
				this.setCapabilityValue('ScrubbingType', Boolean(mode - 1));
			});

			this.vacbot.on('CleanLog', async (object) => {
				this.vacbot.downloadSecuredContent(object[0].imageUrl, '/userdata/latestCleanLog_(' + data.id + ').png');
				if (typeof latestCleanLogImage == 'undefined') {
					const latestCleanLogImage = await this.homey.images.createImage();
					latestCleanLogImage.setPath('/userdata/latestCleanLog_(' + data.id + ').png');
					this.setCameraImage('Lastest Cleanlog', 'Lastest Cleanlog', latestCleanLogImage);
				}
				this.vacbot.downloadSecuredContent(object[1].imageUrl, '/userdata/previousCleanLog_(' + data.id + ').png');
				if (typeof previousCleanLogImage == 'undefined') {
					const previousCleanLogImage = await this.homey.images.createImage();
					previousCleanLogImage.setPath('/userdata/previousCleanLog_(' + data.id + ').png');
					this.setCameraImage('Previous Cleanlog', 'Previous Cleanlog', previousCleanLogImage);
				}
				var stopReason = -1;
				switch ((object[0].stopReason - 1).toString()) {
					case '0': stopReason = 'CLEAN_SUCCESSFUL'; break;
					case '1': stopReason = 'BATTERY_LOW'; break;
					case '2': stopReason = 'STOPPED_BY_APP'; break;
					case '3': stopReason = 'STOPPED_BY_IR'; break;
					case '4': stopReason = 'STOPPED_BY_BUTTON'; break;
					case '5': stopReason = 'STOPPED_BY_WARNING'; break;
					case '6': stopReason = 'STOPPED_BY_NO_DISTURB'; break;
					case '7': stopReason = 'STOPPED_BY_CLEARMAP'; break;
					case '8': stopReason = 'STOPPED_BY_NO_PATH'; break;
					case '9': stopReason = 'STOPPED_BY_NOT_IN_MAP'; break;
					case '10': stopReason = 'STOPPED_BY_VIRTUAL_WALL'; break;
					case '11': stopReason = 'WIRE_CHARGING'; break;
					case '12': stopReason = 'STOPPED_BY_AIR_SPOT'; break;
					case '13': stopReason = 'STOPPED_BY_AIR_AUTO'; break;
					default: stopReason = 'UNKNOWN';
				}
				const tokens = {
					image: CleanLogTriggerImage,
					date: object[0].date.toString(),
					type: object[0].type.toString(),
					stopReason: stopReason,
					mopped: this.getCapabilityValue('MopStatus')
				};

				if (!init) {
					this.log('New CleanLog was received');
					cleanReportTrigger.trigger(this, tokens);
				} else {
					init = false;
				}
			});

			this.vacbot.on('CleanReport', (status) => {
				if (status !== this.getCapabilityValue('Operation')) {
					this.log('Current Operation: ' + status);
					switch (status) {
						case 'idle':
							this.setCapabilityValue('AutoClean', false);
							this.setCapabilityValue('ReturnDock', false);
							this.setCapabilityValue('PauseCleaning', false);
							this.vacbot.run('GetCleanLogs');
							break;
						case 'auto':
							this.setCapabilityValue('AutoClean', true);
							this.setCapabilityValue('ReturnDock', false);
							this.setCapabilityValue('PauseCleaning', false);
							break;
						case 'returning':
							this.setCapabilityValue('AutoClean', false);
							this.setCapabilityValue('ReturnDock', true);
							this.setCapabilityValue('PauseCleaning', false);
							break;
						case 'pause':
							this.setCapabilityValue('PauseCleaning', true);
							break;
						default:
							this.setCapabilityValue('ReturnDock', false);
							this.setCapabilityValue('AutoClean', false);
							this.setCapabilityValue('PauseCleaning', false);
					}
					// if (status == 'idle') {
					// 	this.vacbot.run('GetCleanLogs');
					// 	//this.setCapabilityValue('onoff', false);
					// 	this.setCapabilityValue('AutoClean', false);
					// } else if (status !== 'auto') {
					// 	this.setCapabilityValue('AutoClean', false);
					// }
				}
				this.setCapabilityValue('Operation', status);
				changeOperationTrigger.trigger(this, { operation: status });
			});

			this.vacbot.on('ChargeState', (status) => {
				let oldStatus = this.getCapabilityValue('Charge');
				this.setCapabilityValue('Charge', status);

				if (oldStatus && (oldStatus != status)) {
					try {
						changeChargeStateTrigger.trigger(this, { state: status});
					}
					catch (error) {
						this.log('trigger error : ', error);
					}
				}
			});

			this.vacbot.on('Maps', (maps) => {
				this.log('onMaps received');
				var mapnames = this.getStoreValue('mapnames');
				for (const i in maps['maps']) {
					mapnames.push(
						{
							"mapid": maps['maps'][i]['mapID'],
							"mapIndex": maps['maps'][i]['mapIndex'],
							"mapName": maps['maps'][i]['mapName'],
							"mapStatus": maps['maps'][i]['mapStatus'],
							"mapIsCurrentMap": maps['maps'][i]['mapIsCurrentMap']
						}
					);
					this.setStoreValue('mapnames', mapnames);
					const mapID = maps['maps'][i]['mapID'];
					const mapIndex = maps['maps'][i]['mapIndex'];
					if (maps['maps'][i]['mapIsCurrentMap']) {
						this.setStoreValue('currentMap', { "mapID": mapID, "mapIndex": mapIndex });
					}
					this.vacbot.run('GetSpotAreas', mapID);
				}
				var wait4maps = setTimeout(() => {
					this.createTokens();
				}, 15000);
			});

			this.vacbot.on('MapSpotAreas', (spotAreas) => {
				for (const i in spotAreas['mapSpotAreas']) {
					const spotAreaID = spotAreas['mapSpotAreas'][i]['mapSpotAreaID'];
					this.vacbot.run('GetSpotAreaInfo', spotAreas['mapID'], spotAreaID);
				}
			});

			this.vacbot.on('MapSpotAreaInfo', (area) => {
				var tableAreas = this.getStoreValue('areas');
				if (!tableAreas.find(o => o.id == area.mapSpotAreaID)) {
					tableAreas.push(
						{
							mapid: area.mapID,
							name: area.mapSpotAreaName,
							id: area.mapSpotAreaID,
							toto: area.mapSpotAreaBoundaries,
							boundaries: this.convertBoundaries(area.mapSpotAreaBoundaries),
						}
					);
					this.setStoreValue('areas', tableAreas);

				}
			});

			this.vacbot.on("DeebotPosition", (values) => {
				let CurrentZone = "unknown";
				let OldZone = this.getCapabilityValue('CurrentZone');
				let currentMap = this.getStoreValue('currentMap');
				var tableAreas = this.getStoreValue('areas');
				tableAreas.forEach(function (area) {
					let coord = values.split(',');
					if (tools.pointInPolygon(area.boundaries, [Number(coord[0]), Number(coord[1])]) && area.mapid == currentMap.mapID) {
						CurrentZone = area.name;
					}
				});
				this.setCapabilityValue('CurrentZone', CurrentZone);
				if (OldZone && (OldZone != CurrentZone)) {
					try {
						this.setCapabilityValue('PauseCleaning', false);
						changeZoneTrigger.trigger(this, { zone: CurrentZone });
					}
					catch (error) {
						this.log('trigger error : ', error);
					}
				}
			});
		});

		this.vacbot.connect();

		setInterval(async function () {
			//var tableAreas = app.getStoreValue('areas');
			//console.log(tableAreas)
		}, SYNC_INTERVAL);

	}

	async ready() {
		this.log('device:ready');
	}

	onDiscoveryResult(discoveryResult) {
		this.log('onDiscoveryResult');
		return discoveryResult.id === this.getData().id;
	}

	onDiscoveryAvailable(discoveryResult) {
		this.log('onDiscoveryAvailable', discoveryResult);
		//this.setStoreValue('address', discoveryResult.address);
	}

	onDiscoveryAddressChanged(discoveryResult) {
		this.log('onDiscoveryAddressChanged', discoveryResult);
		// todo set in store
	}

	onDiscoveryLastSeenChanged(discoveryResult) {
		this.log('onLastSeenChanged', discoveryResult);
	}

	/**
	 * onSettings is called when the user updates the device's settings.
	 * @param {object} event the onSettings event data
	 * @param {object} event.oldSettings The old settings object
	 * @param {object} event.newSettings The new settings object
	 * @param {string[]} event.changedKeys An array of keys changed since the previous version
	 * @returns {Promise<string|void>} return a custom message that will be displayed
	 */
	async onSettings({ oldSettings, newSettings, changedKeys }) {
		this.log('MyDevice settings where changed', oldSettings, newSettings, changedKeys);
	}

	/**
	 * onRenamed is called when the user updates the device's name.
	 * This method can be used this to synchronise the name to the device.
	 * @param {string} name The new name
	 */
	async onRenamed(name) {
		this.log('Device was renamed to' + this.getName());
	}

	/**
	 * onDeleted is called when the user deleted the device.
	 */
	async onDeleted() {
		this.log('Device ' + this.getName() + 'has been deleted');
		this.vacbot.disconnect();
		// should perform some cleanup
	}


	//////////////////////////////////////////// Capabilities ///////////////////////////////////////

	// this method is called when the Device has requested a state change (turned on or off)
	// async onCapabilityOnoff(value, opts) {
	// 	if (this.getCapabilityValue('onoff')) {
	// 		// was not idle : go back to charge
	// 		this.log('stop cleaning');
	// 		this.vacbot.run('Charge');
	// 	} else {
	// 		// was idle : start cleaning (general)
	// 		this.log('start cleaning');
	// 		this.vacbot.run('Clean');
	// 	}
	// }

	async onCapabilityVacuumPower(value, opts) {
		this.vacbot.run('SetCleanSpeed', Number(value));
	}

	async onCapabilityCleanCount(boolean, opts) {
		this.log('onCapabilityCleanCount: ' + (Number(boolean) + 1));
		this.vacbot.run('SetCleanCount', (Number(boolean) + 1));
	}

	async onCapabilityWaterFlowLevel(value, opts) {
		this.vacbot.run('SetWaterLevel', Number(value), (Number(this.getCapabilityValue('ScrubbingType')) + 1));
	}

	async onCapabilityAutoEmpty(boolean, opts) {
		this.vacbot.run('SetAutoEmpty', Number(boolean));
	}

	async onCapabilityScrubbingType(boolean, opts) {
		this.vacbot.run('SetWaterLevel', this.getCapabilityValue('WaterFlowLevel'), (Number(boolean) + 1));
	}

	async onCapabilityAromaMode(value, opts) {
		//
	}

	async onCapabilityAutoClean(value, opts) {
		if (value) {
			this.vacbot.clean();
		} else {
			this.vacbot.stop();
		}
	}

	async onCapabilityPauseCleaning(value, opts) {
		if (value) {
			this.vacbot.run("Pause");
		} else {
			this.vacbot.run("Resume");
		}
	}
	async onCapabilityReturnDock(value, opts) {
		this.vacbot.run("Charge");
	}

	//////////////////////////////////////////// Triggers ////////////////////////////////////

	// triggerNewCleanReport(device, tokens) {
	// 	this.cleanreport
	// 		.trigger(device, tokens)
	// 		.catch(this.error);
	// }

	//////////////////////////////////////////// Flows ///////////////////////////////////////

	async flowAutocompleteactionSpotArea(query, args) {
		var tableAreas = this.getStoreValue('areas');
		var filtered = tableAreas.filter((element) => {
			return element.name.toLowerCase().includes(query.toLowerCase());
		});
		return filtered;
	}

	async flowactionSpotArea(args, state) {
		var mapID = this.getStoreValue('currentMap');
		// Only able to start spotcleaning if on the right map
		if (mapID != args.zone.mapid) {
			this.homey.notifications.createNotification({ excerpt: 'Wrong Map! The spot you selecter is on mapid ' + args.zone.mapid + ' while the Deebot is currently located on map ' + mapID });
		}
		//this.vacbot.spotArea(args.zone.id);
		this.log('args.zone.id: ' + args.zone.id);
		this.log('args.zones.id: ' + args.zones.id);
	}

	async flowRechargeAction(args, state) {
		this.log('Return to recharge');
		// args.zone.name ; args.zone.id
		this.vacbot.charge();
	}


	//////////////////////////////////////////// Utilities ///////////////////////////////////////

	convertBoundaries(areaBoundaries) {
		let tableau = areaBoundaries.split(';');
		let resultat = [];

		tableau.forEach(function (element) {
			let point = element.split(',');
			resultat.push([Number(point[0]), Number(point[1])]);
		});

		return resultat;
	}

	async createTokens() {
		var mapnames = this.getStoreValue('mapnames');
		var areas = this.getStoreValue('areas');
		var flowTokens = this.getStoreValue('flowTokens') || [];
		flowTokens.forEach(async (flowToken) => {
			try {
				const removeToken = this.homey.flow.getToken(flowToken);
				this.homey.flow.unregisterToken(removeToken);
			}
			catch (error) {
				this.log('error: ', error);
			}
		});

		while (flowTokens.length) {
			flowTokens.pop();
		}

		areas.forEach(async (area) => {
			var level = mapnames.findIndex((x) => { return x.mapid === area.mapid; });
			var mapName = mapnames.filter(obj => { return obj.mapid === area.mapid; });
			var tokenName = mapName[0].mapName + ' - ' + area.name;
			var tokenID = level + ':' + area.id;
			flowTokens.push(tokenID);
			const createToken = await this.homey.flow.createToken(tokenID, {
				type: "string",
				title: tokenName,
			});
			try {
				await createToken.setValue('[' + level + ':' + area.id + ']');
			}
			catch (error) {
				this.log('error: ', error);
			}
			this.setStoreValue('flowTokens', flowTokens);
		});
	}

}

module.exports = VacuumDevice;

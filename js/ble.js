/**
 * Web Bluetooth connection to the M5Stack -- a JS port of
 * companion_app/ble_transport.py's send_map(), using navigator.bluetooth
 * instead of bleak. Only knows about connecting and writing bytes; has no
 * idea what a "route" is (see protocol.js for that).
 *
 * Requires Chrome (or another Chromium-based browser) on Android, served
 * over HTTPS or localhost -- see webapp/README.md.
 */
import { SERVICE_UUID, CHARACTERISTIC_UUID, BLE_CHUNK_SIZE, BLE_CHUNK_DELAY_MS, BLE_TRANSFER_COMPLETE_DELAY_MS } from './config.js';
import { PacketType, buildMapPayload } from './protocol.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class BleConnection {
  constructor() {
    this.device = null;
    this.characteristic = null;
    /** Set this to a function to be notified when the link drops. */
    this.onDisconnected = null;
  }

  get isConnected() {
    return Boolean(this.device?.gatt?.connected && this.characteristic);
  }

  /**
   * Opens the browser's device picker (must be called directly from a user
   * gesture, e.g. inside a button click handler -- Web Bluetooth refuses
   * to open the picker otherwise), connects, and caches the characteristic.
   */
  async connect() {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth isn\u2019t available in this browser. Use Chrome on Android.');
    }

    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE_UUID] }],
    });

    this.device.addEventListener('gattserverdisconnected', () => {
      this.characteristic = null;
      if (this.onDisconnected) this.onDisconnected();
    });

    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    this.characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);
  }

  disconnect() {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
  }

  async _writePacket(packetType, payloadBytes = new Uint8Array(0)) {
    const packet = new Uint8Array(1 + payloadBytes.length);
    packet[0] = packetType;
    packet.set(payloadBytes, 1);
    await this.characteristic.writeValueWithoutResponse(packet);
  }

  /**
   * Sends a route as MAP_START + MAP_CHUNK* + MAP_END, chunked the same
   * way ble_transport.py's send_map() does.
   * @param {{x:number, y:number}[]} routePoints local (x, y) meters
   */
  async sendMap(routePoints) {
    if (!this.isConnected) {
      throw new Error('Not connected to the bike computer.');
    }

    const payload = buildMapPayload(routePoints, []);

    await this._writePacket(PacketType.MAP_START, payload.slice(0, BLE_CHUNK_SIZE));
    await sleep(BLE_CHUNK_DELAY_MS);

    let offset = BLE_CHUNK_SIZE;
    while (offset < payload.length) {
      await this._writePacket(PacketType.MAP_CHUNK, payload.slice(offset, offset + BLE_CHUNK_SIZE));
      await sleep(BLE_CHUNK_DELAY_MS);
      offset += BLE_CHUNK_SIZE;
    }

    await this._writePacket(PacketType.MAP_END);
    await sleep(BLE_TRANSFER_COMPLETE_DELAY_MS);
  }
}

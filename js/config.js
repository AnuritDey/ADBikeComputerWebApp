/**
 * Shared constants -- mirrors companion_app/config.py and firmware/config.h.
 * If you ever change UUIDs or COORD_SCALE, all three need the same edit.
 */

// Web Bluetooth wants lowercase, hyphenated UUIDs -- same identifiers as
// the Python/C++ side, just cased per the Web Bluetooth spec's convention.
export const SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const CHARACTERISTIC_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
export const DEVICE_NAME = 'M5Stack_Nav';

// Fixed-point scale for encoding coordinates -- must match COORD_SCALE in
// config.py / firmware/config.h, or positions will decode to the wrong meters.
export const COORD_SCALE = 2.0;

// BLE chunked-transfer tuning -- mirrors BLE_CHUNK_SIZE / BLE_CHUNK_DELAY_S
// in companion_app/config.py.
export const BLE_CHUNK_SIZE = 100;
export const BLE_CHUNK_DELAY_MS = 30;
export const BLE_TRANSFER_COMPLETE_DELAY_MS = 500;

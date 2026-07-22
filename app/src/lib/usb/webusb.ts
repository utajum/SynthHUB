// WebUSB helper for Behringer devices (VID 0x1397). WebMIDI is the primary
// transport; WebUSB identifies units by USB product id for discovery.
import { BEHRINGER_VID } from '../types';

export interface UsbDeviceInfo {
  vendorId: number;
  productId: number;
  productName?: string;
  serialNumber?: string;
  // "0x1240" style lowercase hex for matching against the pid map
  pidHex: string;
}

function toInfo(d: USBDevice): UsbDeviceInfo {
  return {
    vendorId: d.vendorId,
    productId: d.productId,
    productName: d.productName ?? undefined,
    serialNumber: d.serialNumber ?? undefined,
    pidHex: '0x' + d.productId.toString(16).padStart(4, '0'),
  };
}

class UsbEngine {
  static get supported(): boolean {
    return typeof navigator !== 'undefined' && 'usb' in navigator;
  }

  // devices the user already granted access to (no prompt)
  async listGranted(): Promise<UsbDeviceInfo[]> {
    if (!UsbEngine.supported) return [];
    const devices = await navigator.usb.getDevices();
    return devices.filter((d) => d.vendorId === BEHRINGER_VID).map(toInfo);
  }

  // prompt the user to pick a Behringer device (user-gesture driven)
  async requestDevice(): Promise<UsbDeviceInfo | null> {
    if (!UsbEngine.supported) return null;
    try {
      const d = await navigator.usb.requestDevice({
        filters: [{ vendorId: BEHRINGER_VID }],
      });
      return toInfo(d);
    } catch {
      return null; // user cancelled
    }
  }

  // revoke one granted device by pidHex, or all Behringer devices when omitted
  async forget(pidHex?: string): Promise<void> {
    if (!UsbEngine.supported) return;
    const target = pidHex?.toLowerCase();
    const devices = await navigator.usb.getDevices();
    for (const d of devices) {
      if (d.vendorId !== BEHRINGER_VID) continue;
      const hex = '0x' + d.productId.toString(16).padStart(4, '0');
      if (target && hex !== target) continue;
      await d.forget();
    }
  }

  onConnect(cb: (d: UsbDeviceInfo) => void): () => void {
    if (!UsbEngine.supported) return () => {};
    const handler = (e: USBConnectionEvent) => {
      if (e.device.vendorId === BEHRINGER_VID) cb(toInfo(e.device));
    };
    navigator.usb.addEventListener('connect', handler);
    return () => navigator.usb.removeEventListener('connect', handler);
  }

  onDisconnect(cb: (d: UsbDeviceInfo) => void): () => void {
    if (!UsbEngine.supported) return () => {};
    const handler = (e: USBConnectionEvent) => {
      if (e.device.vendorId === BEHRINGER_VID) cb(toInfo(e.device));
    };
    navigator.usb.addEventListener('disconnect', handler);
    return () => navigator.usb.removeEventListener('disconnect', handler);
  }
}

// process-wide singleton
export const usb = new UsbEngine();

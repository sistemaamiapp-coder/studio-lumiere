import QRCode from 'qrcode';
import { BUSINESS } from './config.js';
import { round2 } from './utils.js';

function emv(id, value) {
  const text = String(value);
  const length = String(text.length).padStart(2, '0');
  return `${id}${length}${text}`;
}

function deaccent(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .toUpperCase()
    .trim();
}

function crc16(payload) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function pixPayload({ amount, txid }) {
  const value = round2(amount || 0);
  const key = String(BUSINESS.pixKey);
  const merchant = emv('00', 'BR.GOV.BCB.PIX') + emv('01', key);
  let payload = emv('00', '01');
  payload += emv('26', merchant);
  payload += emv('52', '0000');
  payload += emv('53', '986');
  if (value > 0) payload += emv('54', value.toFixed(2));
  payload += emv('58', 'BR');
  payload += emv('59', deaccent(BUSINESS.pixName).slice(0, 25));
  payload += emv('60', deaccent(BUSINESS.pixCity).slice(0, 15));
  const cleanTxid = String(txid || 'LUMIERE').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || 'LUMIERE';
  payload += emv('62', emv('05', cleanTxid));
  payload += '6304';
  return payload + crc16(payload);
}

export async function pixQrDataUrl(payload) {
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 380,
    color: { dark: '#3C2435', light: '#FFFFFF' }
  });
}

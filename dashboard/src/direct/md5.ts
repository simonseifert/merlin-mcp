/**
 * MD5 of a UTF-8 string, as lowercase hex. Only used to check the signature Moodle's launch.php puts
 * on the token it hands back (md5(site url + passport)), the same check scripts/get-token.mjs does.
 * Not used for anything secret: MD5 is fine for matching a value we chose ourselves.
 */

const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export function md5(text: string): string {
	const msg = new TextEncoder().encode(text);
	const len = ((msg.length + 8) >>> 6) * 64 + 64;
	const buf = new Uint8Array(len);
	buf.set(msg);
	buf[msg.length] = 0x80;
	const bits = msg.length * 8;
	const view = new DataView(buf.buffer);
	view.setUint32(len - 8, bits >>> 0, true);
	view.setUint32(len - 4, Math.floor(bits / 2 ** 32), true);

	let a0 = 0x67452301;
	let b0 = 0xefcdab89;
	let c0 = 0x98badcfe;
	let d0 = 0x10325476;
	for (let off = 0; off < len; off += 64) {
		let a = a0;
		let b = b0;
		let c = c0;
		let d = d0;
		for (let i = 0; i < 64; i++) {
			let f: number;
			let g: number;
			if (i < 16) {
				f = (b & c) | (~b & d);
				g = i;
			} else if (i < 32) {
				f = (d & b) | (~d & c);
				g = (5 * i + 1) % 16;
			} else if (i < 48) {
				f = b ^ c ^ d;
				g = (3 * i + 5) % 16;
			} else {
				f = c ^ (b | ~d);
				g = (7 * i) % 16;
			}
			const tmp = d;
			d = c;
			c = b;
			const sum = (a + f + K[i] + view.getUint32(off + g * 4, true)) >>> 0;
			b = (b + ((sum << S[i]) | (sum >>> (32 - S[i])))) >>> 0;
			a = tmp;
		}
		a0 = (a0 + a) >>> 0;
		b0 = (b0 + b) >>> 0;
		c0 = (c0 + c) >>> 0;
		d0 = (d0 + d) >>> 0;
	}
	const out = new DataView(new ArrayBuffer(16));
	[a0, b0, c0, d0].forEach((v, i) => out.setUint32(i * 4, v, true));
	return Array.from(new Uint8Array(out.buffer), (x) => x.toString(16).padStart(2, '0')).join('');
}

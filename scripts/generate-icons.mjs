import { Buffer } from 'node:buffer';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const sizes = [16, 24, 32, 48, 64, 128, 256];
const source = resolve('build/icon.svg');
const destination = resolve('build/icon.ico');

function createIco(images) {
  const directorySize = 6 + images.length * 16;
  const header = Buffer.alloc(directorySize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = directorySize;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });

  return Buffer.concat([header, ...images.map(({ png }) => png)]);
}

const svg = await readFile(source);
const images = await Promise.all(
  sizes.map(async (size) => ({
    size,
    png: await sharp(svg, { density: 384 })
      .resize(size, size, { fit: 'fill' })
      .png()
      .toBuffer(),
  })),
);

if (images.some(({ png }) => png.length === 0)) {
  throw new Error('Sharp generated an empty PNG icon variant');
}

await writeFile(destination, createIco(images));
console.log(`Generated ${destination} (${sizes.join(', ')} px)`);

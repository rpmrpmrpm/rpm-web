// A size as people read it: "12.4 GB", as the desktop's ByteSize writes it. 1,024 to a unit, no decimals below a
// megabyte, one above, in the browser's number format.
export function byteSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return unit < 2 ? `${Math.round(value)} ${units[unit]}` : `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unit]}`;
}

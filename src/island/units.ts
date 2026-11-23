import { calculate, formatResult } from './calc';

/**
 * Unit conversion for the launcher: "10 km to mi", "=70kg in lb", "100 f to c",
 * "(2+3) gb to mib". The amount may be any calculator expression. Works
 * offline; currencies are left out on purpose (they need live rates).
 */

type Category = 'length' | 'mass' | 'temperature' | 'volume' | 'data' | 'time' | 'speed';

/** A unit: its category, its size in the category's base unit, and the symbol shown in results. */
type Unit = { category: Category; factor: number; symbol: string };

const U = (category: Category, factor: number, symbol: string, ...aliases: string[]) =>
  aliases.map((a) => [a, { category, factor, symbol }] as const);

const UNITS = new Map<string, Unit>([
  // Length, base metre.
  ...U('length', 0.001, 'mm', 'mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres'),
  ...U('length', 0.01, 'cm', 'cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres'),
  ...U('length', 1, 'm', 'm', 'meter', 'meters', 'metre', 'metres'),
  ...U('length', 1000, 'km', 'km', 'kilometer', 'kilometers', 'kilometre', 'kilometres'),
  ...U('length', 0.0254, 'in', 'in', 'inch', 'inches', '"'),
  ...U('length', 0.3048, 'ft', 'ft', 'foot', 'feet', "'"),
  ...U('length', 0.9144, 'yd', 'yd', 'yard', 'yards'),
  ...U('length', 1609.344, 'mi', 'mi', 'mile', 'miles'),
  ...U('length', 1852, 'nmi', 'nmi', 'nauticalmile', 'nauticalmiles'),
  // Mass, base gram.
  ...U('mass', 0.001, 'mg', 'mg', 'milligram', 'milligrams'),
  ...U('mass', 1, 'g', 'g', 'gram', 'grams'),
  ...U('mass', 1000, 'kg', 'kg', 'kilogram', 'kilograms', 'kilo', 'kilos'),
  ...U('mass', 1_000_000, 't', 't', 'tonne', 'tonnes', 'ton', 'tons'),
  ...U('mass', 28.349523125, 'oz', 'oz', 'ounce', 'ounces'),
  ...U('mass', 453.59237, 'lb', 'lb', 'lbs', 'pound', 'pounds'),
  ...U('mass', 6350.29318, 'st', 'st', 'stone', 'stones'),
  // Temperature: factor unused, converted by formula.
  ...U('temperature', 1, '°C', 'c', '°c', 'celsius'),
  ...U('temperature', 1, '°F', 'f', '°f', 'fahrenheit'),
  ...U('temperature', 1, 'K', 'k', 'kelvin'),
  // Volume, base litre (US customary for gallons, quarts, pints, cups, fluid ounces).
  ...U('volume', 0.001, 'ml', 'ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'),
  ...U('volume', 1, 'l', 'l', 'liter', 'liters', 'litre', 'litres'),
  ...U('volume', 3.785411784, 'gal', 'gal', 'gallon', 'gallons'),
  ...U('volume', 0.946352946, 'qt', 'qt', 'quart', 'quarts'),
  ...U('volume', 0.473176473, 'pt', 'pt', 'pint', 'pints'),
  ...U('volume', 0.2365882365, 'cup', 'cup', 'cups'),
  ...U('volume', 0.0295735295625, 'fl oz', 'floz', 'fl oz'),
  // Data, base byte: KB/MB/GB/TB are decimal, KiB/MiB/GiB/TiB binary, as Windows Explorer's sizes are.
  ...U('data', 0.125, 'bit', 'bit', 'bits'),
  ...U('data', 1, 'B', 'b', 'byte', 'bytes'),
  ...U('data', 1e3, 'KB', 'kb', 'kilobyte', 'kilobytes'),
  ...U('data', 1e6, 'MB', 'mb', 'megabyte', 'megabytes'),
  ...U('data', 1e9, 'GB', 'gb', 'gigabyte', 'gigabytes'),
  ...U('data', 1e12, 'TB', 'tb', 'terabyte', 'terabytes'),
  ...U('data', 1024, 'KiB', 'kib'),
  ...U('data', 1024 ** 2, 'MiB', 'mib'),
  ...U('data', 1024 ** 3, 'GiB', 'gib'),
  ...U('data', 1024 ** 4, 'TiB', 'tib'),
  // Time, base second.
  ...U('time', 0.001, 'ms', 'ms', 'millisecond', 'milliseconds'),
  ...U('time', 1, 's', 's', 'sec', 'secs', 'second', 'seconds'),
  ...U('time', 60, 'min', 'min', 'mins', 'minute', 'minutes'),
  ...U('time', 3600, 'h', 'h', 'hr', 'hrs', 'hour', 'hours'),
  ...U('time', 86_400, 'd', 'd', 'day', 'days'),
  ...U('time', 604_800, 'wk', 'wk', 'week', 'weeks'),
  ...U('time', 31_557_600, 'yr', 'yr', 'year', 'years'),
  // Speed, base metre per second.
  ...U('speed', 1, 'm/s', 'm/s', 'mps'),
  ...U('speed', 1000 / 3600, 'km/h', 'km/h', 'kmh', 'kph'),
  ...U('speed', 1609.344 / 3600, 'mph', 'mph'),
  ...U('speed', 1852 / 3600, 'kn', 'kn', 'knot', 'knots'),
]);

/** Any temperature to kelvin and back. */
const toKelvin: Record<string, (v: number) => number> = {
  '°C': (v) => v + 273.15,
  '°F': (v) => ((v - 32) * 5) / 9 + 273.15,
  K: (v) => v,
};
const fromKelvin: Record<string, (v: number) => number> = {
  '°C': (v) => v - 273.15,
  '°F': (v) => ((v - 273.15) * 9) / 5 + 32,
  K: (v) => v,
};

export type Conversion = { value: number; from: Unit; to: Unit; result: number };

/**
 * "<amount> <unit> to|in <unit>". The amount is matched lazily, so "5 in in cm"
 * reads as 5 inches; "fl oz" is joined to one word first.
 */
const PATTERN = /^(.*?)\s*([a-z°"'/]+)\s+(?:to|in|->|=)\s+([a-z°"'/]+)$/;

export function convert(input: string): Conversion | null {
  const text = input.trim().toLowerCase().replace(/fl\s+oz/g, 'floz');
  const m = PATTERN.exec(text);
  if (!m) return null;
  const from = UNITS.get(m[2]);
  const to = UNITS.get(m[3]);
  if (!from || !to || from.category !== to.category) return null;
  const value = m[1] ? calculate(m[1]) : 1;
  if (value == null) return null;
  const result =
    from.category === 'temperature'
      ? fromKelvin[to.symbol](toKelvin[from.symbol](value))
      : (value * from.factor) / to.factor;
  if (!Number.isFinite(result)) return null;
  return { value, from, to, result };
}

/** A number for display: up to 6 significant digits, no exponent below 1e15. */
export function formatAmount(value: number) {
  const rounded = Number(value.toPrecision(6));
  return Math.abs(rounded) < 1e15 ? String(rounded) : formatResult(value);
}

/** "10 km = 6.21371 mi" */
export const describe = (c: Conversion) =>
  `${formatAmount(c.value)} ${c.from.symbol} = ${formatAmount(c.result)} ${c.to.symbol}`;

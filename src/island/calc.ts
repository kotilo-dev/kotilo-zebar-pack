/**
 * A small calculator for the launcher ("=12*7"). It parses the expression
 * itself (recursive descent) instead of handing it to `eval`, so nothing typed
 * there can run as code. Supports + - * / % ^, parentheses, unary minus and
 * decimals with "." or ",". A comma followed by exactly three digits looks
 * like a thousands separator ("1,000"), so such input gets no answer rather
 * than a silently wrong one.
 *
 *   expr   = term (("+" | "-") term)*
 *   term   = unary (("*" | "/" | "%") unary)*
 *   unary  = "-" unary | "+" unary | power     so -2^2 = -(2^2) = -4
 *   power  = atom ("^" unary)?                 right-associative: 2^3^2 = 512
 *   atom   = number | "(" expr ")"
 */
export function calculate(input: string): number | null {
  if (/,[0-9]{3}(?![0-9])/.test(input)) return null;
  const src = input.replace(/\s+/g, '').replace(/,/g, '.').replace(/[x×]/g, '*').replace(/÷/g, '/');
  if (!src || src.length > 200) return null;
  let pos = 0;

  const peek = () => src[pos];
  const eat = (ch: string) => {
    if (src[pos] === ch) {
      pos++;
      return true;
    }
    return false;
  };

  function expr(): number {
    let value = term();
    for (;;) {
      if (eat('+')) value += term();
      else if (eat('-')) value -= term();
      else return value;
    }
  }

  function term(): number {
    let value = unary();
    for (;;) {
      if (eat('*')) value *= unary();
      else if (eat('/')) value /= unary();
      else if (eat('%')) value %= unary();
      else return value;
    }
  }

  function unary(): number {
    if (eat('-')) return -unary();
    if (eat('+')) return unary();
    return power();
  }

  function power(): number {
    const base = atom();
    return eat('^') ? Math.pow(base, unary()) : base;
  }

  function atom(): number {
    if (eat('(')) {
      const value = expr();
      if (!eat(')')) throw new Error('missing )');
      return value;
    }
    const start = pos;
    while (pos < src.length && /[0-9.]/.test(src[pos])) pos++;
    const text = src.slice(start, pos);
    if (!/^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(text)) throw new Error(`unexpected ${peek() ?? 'end'}`);
    return Number(text);
  }

  try {
    const value = expr();
    if (pos !== src.length || !Number.isFinite(value)) return null;
    return value;
  } catch {
    return null;
  }
}

/** A result as plain digits for copying: up to 12 significant digits, no grouping, no trailing zeros. */
export function formatResult(value: number) {
  // Whole numbers print in full below 1e21 (where JavaScript switches to exponent notation).
  if (Number.isInteger(value) && Math.abs(value) < 1e21) return String(value);
  return String(Number(value.toPrecision(12)));
}

# zero-js

A C-like language that compiles to standalone HTML and CSS, with zero bytes of JavaScript. Variables, functions, loops, tail recursion, arrays, strings, drawing, and animation all run as CSS calculations that update live as the inputs change.

## Getting started

```sh
pnpm install
pnpm dev
```

Open http://localhost:3000, write code on the left, and see the compiled document in a sandboxed iframe on the right. **Export HTML** saves a file that runs on its own.

You need a current desktop browser that supports `@property`, `anchor-size()`, CSS typed arithmetic, container query units and style queries, `round()`, `abs()`, and `sign()`. The editor uses WebGPU for syntax highlighting (via `gpu-lexer`) when it's available and falls back to plain text otherwise.

## Example

```c
int gcd(int a, int b) {
  return b == 0 ? a : gcd(b, a % b);
}

int a = input("a", 84, 200);
int b = input("b", 30, 200);
print(gcd(a, b));
```

The playground comes with fifteen demos: a + b, a live `print(time())` clock, RSA, GCD, Fibonacci, Nth prime, FizzBuzz, bubble sort, temperature conversion, geometry, orbit, wave, the Mandelbrot set, a hold-to-jump game, and 3n+1.

## Language

- **Types**: `int`, `float`, `string`, and fixed-size arrays (`int values[3] = {9, 2, 7};`, with 1–32 elements).
- **Operators**: `+ - * / %`, `< > <= >= == !=`, `&& || !`, and `?:`. `%` follows CSS `mod()`, so the result takes the sign of the divisor.
- **Math**: `min`, `max`, `clamp`, `abs`, `sign`, `floor`, `ceil`, `round`, `sqrt`, `hypot`, `mod`, `rem`, `sin`, `cos`, `tan`, `atan2`.
- **Control flow**: `if` / `else`, `for` loops with literal bounds (up to 128 iterations), `break`, `continue`.
- **Functions**: int, float, or string parameters and return values. Direct tail recursion works, limited by the **Recursion steps** setting (default 64).
- **Strings**: you can assign and compare them (`==`, `!=`), but not concatenate them.
- **Output**: `print(value)` and `print(array)`.
- **Drawing**: `canvas(w, h)`, `rect`, `circle`, and `line`, each with an optional color: a hex string, or any string expression that selects one, such as `click() ? "#11150e" : "#ff0"`. A string that isn't a hex color draws in the default color.
- **Animation**: `time(seconds)` returns a looping clock.

### Inputs

| Call | Value |
| --- | --- |
| `input("label", initial, max, min)` | Slider value (defaults: 0, 100, 0) |
| `click()` | Switches between 0 and 1 on each click anywhere on the page |
| `press()` | 1 while the mouse button or Space is held |
| `hold_time(duration)` | Seconds held so far, up to `duration` (default 1) |
| `arrow_x(max)`, `arrow_y(max)` | Position controlled by the arrow keys or scrolling |
| `toggle`, `pressed`, `hold_time("label")`, `scroll_x`, `scroll_y` | Visible, named versions of the controls above |
| `typed("label", "w")` | 1 when the text field contains that character |

A labeled input must be the direct initializer of a top-level numeric variable or array element. The page inputs `click()`, `press()`, `hold_time()`, `arrow_x()`, and `arrow_y()` can also be read inline in any expression outside a function, such as `if (click()) { ... }`. All reads of the same page input share one value. To use an input inside a function, pass it in as an argument.

## How it works

Values are stored in registered CSS custom properties. Sliders are native resizable textareas, and their widths are read with `anchor-size()` and container query units. Conditions become arithmetic masks. For example, `a > b` becomes `max(0, sign(a - b))`, and `c ? x : y` becomes `c * x + (1 - c) * y`. Statements run as nested elements that inherit state from their parents. Loop iterations reuse the same CSS rules, so only the HTML gets longer. When iterations share no state (the body only assigns its own locals, with no `break` or `return`), they run as sibling elements instead of nesting, so a 32×24 grid of Mandelbrot cells stays shallow. Strings are stored as numeric IDs and turned back into text with a `@counter-style` dictionary. A computed drawing color stores its string ID, and nested `color-mix()` calls pick the matching hex literal. With **CSS @function** enabled, simple functions compile to native `@function` definitions.

There are no algorithm-specific shortcuts. Every program expands into a finite CSS dependency graph.

## Limitations

- Unbounded loops, non-tail or mutual recursion, access to globals from inside functions, and string arithmetic aren't supported.
- Assignments don't carry over between animation frames. Each frame recomputes the program from the current inputs.
- Numbers are clamped to ±1,000,000, and precision depends on the browser's CSS math. Dividing by zero at runtime gives 0.
- A program can have at most 20,000 characters, 128 statements, 480 levels of nesting, and 12,000 generated HTML elements.

## Development

```sh
pnpm test:compiler
pnpm typecheck
```

The compiler (`lib/compiler.ts`) and its runtime template (`lib/runtime.ts`) don't depend on React or Next.js:

```ts
compile(source, { cssFunctions: false, recursionSteps: 64 });
```

## Acknowledgement

Idea by [Shu Ding](https://x.com/shuding).

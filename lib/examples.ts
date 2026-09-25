export const EXAMPLES = [
  {
    id: "addition",
    name: "a + b",
    source: `int a = input("a", 120, 200);
int b = input("b", 80, 200);

int sum = a + b;
print(sum);
`,
  },
  {
    id: "clock",
    name: "print(time())",
    source: `// time() is a CSS animation clock: seconds since the page loaded.
// Nothing below runs JavaScript. Every digit is recomputed by CSS each frame.
float t = time(3600);
print(time());

int minutes = floor(t / 60);
int seconds = floor(t % 60);
int centis = floor(t * 100) % 100;

// Seven-segment digit at x. Ghost segments first, then the lit ones.
int digit(float x, int d) {
  rect(x + 6, 20, 28, 6, "#eeeeee");
  rect(x + 34, 26, 6, 30, "#eeeeee");
  rect(x + 34, 62, 6, 30, "#eeeeee");
  rect(x + 6, 92, 28, 6, "#eeeeee");
  rect(x, 62, 6, 30, "#eeeeee");
  rect(x, 26, 6, 30, "#eeeeee");
  rect(x + 6, 56, 28, 6, "#eeeeee");
  if (d != 1 && d != 4) { rect(x + 6, 20, 28, 6, "#0066ff"); }
  if (d != 5 && d != 6) { rect(x + 34, 26, 6, 30, "#0066ff"); }
  if (d != 2) { rect(x + 34, 62, 6, 30, "#0066ff"); }
  if (d != 1 && d != 4 && d != 7) { rect(x + 6, 92, 28, 6, "#0066ff"); }
  if (d == 0 || d == 2 || d == 6 || d == 8) { rect(x, 62, 6, 30, "#0066ff"); }
  if (d != 1 && d != 2 && d != 3 && d != 7) { rect(x, 26, 6, 30, "#0066ff"); }
  if (d > 1 && d != 7) { rect(x + 6, 56, 28, 6, "#0066ff"); }
  return d;
}

canvas(350, 118);
digit(16, minutes / 10);
digit(64, minutes % 10);
digit(128, seconds / 10);
digit(176, seconds % 10);
digit(240, centis / 10);
digit(288, centis % 10);

// The colon blinks twice a second.
if (floor(t * 2) % 2 == 0) {
  rect(113, 40, 6, 6, "#0066ff");
  rect(113, 72, 6, 6, "#0066ff");
}
rect(226, 88, 5, 6, "#0066ff");

print(minutes);
print(seconds);
print(centis);
`,
  },
  {
    id: "rsa",
    name: "RSA",
    source: `// Toy RSA: p = 11, q = 13, modulus = 143.
// Public exponent = 7; private exponent = 103.
// 7 * 103 % ((11 - 1) * (13 - 1)) == 1.
int message = input("message", 42, 142);

int mod_pow(int base, int exponent, int modulus) {
  int result = 1;
  base = base % modulus;

  // Square-and-multiply; 7 bits cover both exponents.
  for (int bit = 0; bit < 7; bit++) {
    if (exponent == 0) {
      break;
    }
    if (exponent % 2 != 0) {
      result = result * base % modulus;
    }
    base = base * base % modulus;
    exponent = exponent / 2;
  }
  return result;
}

int encrypted = mod_pow(message, 7, 143);
int decrypted = mod_pow(encrypted, 103, 143);

print(encrypted);
print(decrypted);
`,
  },
  {
    id: "gcd",
    name: "GCD",
    source: `int a = input("a", 84, 200);
int b = input("b", 30, 200);

// Euclid's algorithm. Each tail call reuses the same CSS rules.
int gcd(int a, int b) {
  if (b == 0) {
    return a;
  }
  return gcd(b, a % b);
}

print(gcd(a, b));
`,
  },
  {
    id: "fibonacci",
    name: "Fibonacci",
    source: `// F(0) = 0, F(1) = 1. Up to F(10).
int n = input("n", 10, 10);

int fibonacci(int n, int a, int b) {
  if (n == 0) {
    return a;
  }
  // Carry consecutive values into the next tail call.
  return fibonacci(n - 1, b, a + b);
}

print(fibonacci(n, 0, 1));
`,
  },
  {
    id: "prime",
    name: "Nth prime",
    source: `// First 20 primes; n = 0 returns 0.
int n = input("n", 10, 20);

// For candidates <= 71, test factors up to sqrt(71).
int is_prime(int candidate) {
  int prime = candidate >= 2;
  if (candidate > 2 && candidate % 2 == 0) {
    prime = 0;
  }
  for (int divisor = 3; divisor <= 7; divisor = divisor + 2) {
    if (candidate > divisor && candidate % divisor == 0) {
      prime = 0;
    }
  }
  return prime;
}

int nth_prime(int n) {
  int count = 0;
  int result = 0;
  for (int candidate = 2; candidate <= 71; candidate++) {
    if (!is_prime(candidate)) {
      continue;
    }
    count = count + 1;
    if (count == n) {
      result = candidate;
      break;
    }
  }
  return result;
}

print(nth_prime(n));
`,
  },
  {
    id: "fizzbuzz",
    name: "FizzBuzz",
    source: `int n = input("n", 15, 100);

string fizzbuzz(int n) {
  if (n % 3 == 0 && n % 5 == 0) {
    return "FizzBuzz";
  }
  if (n % 3 == 0) {
    return "Fizz";
  }
  if (n % 5 == 0) {
    return "Buzz";
  }
  return "";
}

string word = fizzbuzz(n);
print(word == "" ? n : word);
`,
  },
  {
    id: "sorting",
    name: "Bubble sort",
    source: `int values[5] = {
  input("a", 72),
  input("b", 18),
  input("c", 45),
  input("d", 9),
  input("e", 63)
};

// Compare adjacent elements and swap them into order.
for (int pass = 0; pass < 4; pass++) {
  int swapped = 0;
  for (int i = 0; i < 4; i++) {
    if (values[i] > values[i + 1]) {
      int temp = values[i];
      values[i] = values[i + 1];
      values[i + 1] = temp;
      swapped = 1;
    }
  }
  if (!swapped) {
    break;
  }
}

print(values);
`,
  },
  {
    id: "temperature",
    name: "Temperature",
    source: `// Fourth input argument sets the minimum.
float celsius = input("°C", 20, 100, -40);

float fahrenheit(float c) {
  return c * 1.8 + 32;
}

string state = "liquid";
if (celsius < 0) {
  state = "ice";
} else if (celsius >= 100) {
  state = "steam";
}

print(fahrenheit(celsius));
print(state);
`,
  },
  {
    id: "geometry",
    name: "Geometry",
    source: `float angle = input("angle", 35, 180, -180);
float length = input("length", 90, 110);

// Trigonometric functions use radians.
float radians = angle * 0.01745329252;
float x = 160 + cos(radians) * length;
float y = 120 - sin(radians) * length;

canvas(320, 240);
rect(12, 12, 296, 216, "#f5f5f5");
line(20, 120, 300, 120, "#d4d4d4");
line(160, 20, 160, 220, "#d4d4d4");
line(160, 120, x, y, "#0066ff");
line(x, 120, x, y, "#0066ff");
line(160, 120, x, 120, "#0066ff");
circle(160, 120, 4);
circle(x, y, 6, "#000000");
`,
  },
  {
    id: "orbit",
    name: "Orbit",
    source: `float radius = input("radius", 80, 100);

// Seconds, repeating every eight seconds.
float t = time(8);
float angle = t * 6.28318530718 / 8;
float x = 160 + cos(angle) * radius;
float y = 120 + sin(angle) * radius;

canvas(320, 240);
line(160, 120, x, y, "#d4d4d4");
circle(160, 120, 12, "#000000");
circle(x, y, 7, "#0066ff");
`,
  },
  {
    id: "wave",
    name: "Wave",
    source: `float amplitude = input("amplitude", 55, 80);
int points = input("points", 24, 24);
float t = time(6);

// A function can draw and return a value.
float bead(float x, float amplitude, float t) {
  float phase = x / 296 * 6.28318530718;
  float y = 120 + sin(phase - t * 6.28318530718 / 6) * amplitude;
  if (y < 120) {
    circle(x, y, 4, "#0066ff");
  } else {
    circle(x, y, 4, "#000000");
  }
  return y;
}

canvas(320, 240);
line(12, 120, 308, 120, "#d4d4d4");
float previous_x = 0;
float previous_y = 0;
for (int i = 0; i < 24; i++) {
  if (i >= points) { break; }
  float x = 12 + i * 296 / 23;
  float y = bead(x, amplitude, t);
  if (i > 0) {
    line(previous_x, previous_y, x, y, "#a3a3a3");
  }
  previous_x = x;
  previous_y = y;
}
`,
  },
  {
    id: "mandelbrot",
    name: "Mandelbrot",
    source: `// Mandelbrot set: each cell tests one point c = cx + cy*i.
// Iterate z = z*z + c; points that stay within |z| <= 2 are in the set.
// Cells are independent, so every iteration reuses one set of CSS rules.
int depth = input("iterations", 12, 16, 1);

canvas(320, 240);
for (int row = 0; row < 24; row++) {
  for (int col = 0; col < 32; col++) {
    float cx = -2.25 + col * 0.1;
    float cy = -1.15 + row * 0.1;
    float x = 0;
    float y = 0;
    int n = 0;
    for (int i = 0; i < 16; i++) {
      if (i >= depth || x * x + y * y > 4) { break; }
      float t = x * x - y * y + cx;
      y = 2 * x * y + cy;
      x = t;
      n = n + 1;
    }
    rect(col * 10, row * 10, 10, 10,
      n == depth ? "#000000" : n > 7 ? "#0033b3" : n > 4 ? "#0066ff" : n > 2 ? "#80b3ff" : n > 1 ? "#d6e6ff" : "#ffffff");
  }
}
`,
  },
  {
    id: "jump",
    name: "Jump",
    source: `// Hold the mouse or Space to jump. Each hold is one jump:
// release to land, then hold again before the next rock.
float t = time(3);
float air = hold_time(0.8);
float height = 250 * air * (0.8 - air);

float rock = 330 - t * 130;
int hit = rock < 72 && rock > 28 && height < 20;

canvas(320, 160);
rect(0, 128, 320, 32, "#f5f5f5");
rect(rock, 108, 20, 20, "#000000");
circle(60, 116 - height, 12, hit ? "#d92d20" : "#0066ff");
string state = hit ? "ouch" : press() ? "jump" : "run";
print(state);
`,
  },
  {
    id: "collatz",
    name: "3n+1",
    source: `int start = input("start", 6, 32, 1);

int collatz(int n) {
  // Print each step; stop as soon as the sequence reaches 1.
  for (int i = 0; i < 128; i++) {
    print(n);
    if (n == 1) {
      print("reached 1");
      return i;
    }
    if (n % 2 == 0) {
      n = n / 2;
    } else {
      n = 3 * n + 1;
    }
  }
  return 128;
}

int steps = collatz(start);
print(steps);
`,
  },
] as const;

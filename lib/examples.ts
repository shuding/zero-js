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
    source: `float angle = input("angle", 35, 90, -90);
float length = input("length", 90, 110);

// Trigonometric functions use radians.
float radians = angle * 0.01745329252;
float x = 160 + cos(radians) * length;
float y = 120 - sin(radians) * length;

canvas(320, 240);
rect(12, 12, 296, 216, "#eef1e8");
line(20, 120, 300, 120, "#cfd6c7");
line(160, 20, 160, 220, "#cfd6c7");
line(160, 120, x, y, "#647a55");
circle(160, 120, 4);
circle(x, y, 8, "#b96746");
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
line(160, 120, x, y, "#d8dfd0");
circle(160, 120, 12, "#c4984b");
circle(x, y, 7, "#647a55");
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
    circle(x, y, 4, "#647a55");
  } else {
    circle(x, y, 4, "#b96746");
  }
  return y;
}

canvas(320, 240);
line(12, 120, 308, 120, "#d8dfd0");
float previous_x = 0;
float previous_y = 0;
for (int i = 0; i < 24; i++) {
  if (i >= points) { break; }
  float x = 12 + i * 296 / 23;
  float y = bead(x, amplitude, t);
  if (i > 0) {
    line(previous_x, previous_y, x, y, "#aeb9a3");
  }
  previous_x = x;
  previous_y = y;
}
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

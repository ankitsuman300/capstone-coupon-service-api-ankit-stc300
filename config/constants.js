export const allowedOrigins = {
  development: [
    // "https://dev.domain.com",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ],
  test: [
      "https://domain.com",
  ],
  production: [
      "https://domain.com",
  ],
};

export const userRefreshTokenPath = "/api/users/update-refresh-access";
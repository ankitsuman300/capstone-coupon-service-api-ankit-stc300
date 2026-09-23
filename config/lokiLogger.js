import dotenv from "dotenv";
dotenv.config();
import { createLogger, format, transports } from "winston";
import LokiTransport from "winston-loki";



const logTransports = [];

if (process.env.LOKI_HOST) {
  logTransports.push(
    new LokiTransport({
      host: process.env.LOKI_HOST,
      labels: {
        appName: process.env.LOKI_APP_NAME,
        dashboard: process.env.LOKI_DASHBOARD,
      },
      json: true,
      format: format.json(),
      replaceTimestamp: true,
      onConnectionError: (err) =>
        console.error(`Loki connection error: ${err.message}`),
    })
  );
} else {
  logTransports.push(
    new transports.Console({
      format: format.combine(format.timestamp(), format.simple()),
    })
  );
}

const lokiLogger = createLogger({ transports: logTransports });

export default lokiLogger;

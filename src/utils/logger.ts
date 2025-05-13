import winston, { createLogger, format, transports } from "winston";
import TransportStream from "winston-transport";
import { v4 as uuidv4 } from "uuid";

class CaptureLastMessageTransport extends TransportStream {
  public lastMessage: string = "";
  public listMessages: string[] = [];

  constructor() {
    super();
    this.lastMessage = "";
  }

  log(info: any, callback: any) {
    this.lastMessage = info.message;
    this.listMessages.push(this.lastMessage);
    if (callback) callback();
  }

  resetMessages() {
    this.listMessages = [];
    this.lastMessage = "";
  }
}

export const captureTransport = new CaptureLastMessageTransport();

export const initLogger = (label: string, loglevel?: string) => {
  return createLogger({
    level: "info",
    format: winston.format.combine(
      winston.format.printf((info: winston.Logform.TransformableInfo) => {
        if (typeof info.message === "object" && info.message !== null) {
          const message = info.message as Record<string, any>;
          return JSON.stringify({
            level: info.level,
            ...message,
          });
        } else {
          return JSON.stringify({
            level: info.level,
            message: info.message,
          });
        }
      })
    ),
    transports: [new winston.transports.Console()],
  });
};

enum LogStatus {
  START = "start",
  SUCCESS = "success",
  FAILED = "failed",
}

interface LogData {
  request_id: string;
  state: string;
  timestamp: string;
  tool_name: string;
  error?: string;
  params?: Record<string, any>;
}

function logMcpRequest(
  tool_name: string,
  status: LogStatus,
  params?: Record<string, any>,
  error?: Error,
  request_id?: string
): string {
  let finalRequestId = request_id;

  if (status === LogStatus.START) {
    finalRequestId = uuidv4();
  }

  const logData: LogData = {
    request_id: finalRequestId!,
    state: status,
    timestamp: new Date().toISOString(),
    tool_name,
  };

  if (error) {
    logData.error = error.message;
  }

  if (params) {
    logData.params = params;
  }

  if (status === LogStatus.START || status === LogStatus.SUCCESS) {
    logger.info(logData);
  } else if (status === LogStatus.FAILED) {
    logger.error(logData);
  }

  return finalRequestId!;
}

export { LogStatus, logMcpRequest };

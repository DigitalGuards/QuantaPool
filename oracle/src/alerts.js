/**
 * QuantaPool Oracle Alerting
 */

const axios = require('axios');
const config = require('./config');
const logger = require('./logger');

/**
 * Send alert to configured channels
 */
async function sendAlert(message, severity = 'info') {
  const timestamp = new Date().toISOString();
  const fullMessage = `[${severity.toUpperCase()}] [${timestamp}] QuantaPool Oracle: ${message}`;

  // Log locally
  if (severity === 'critical' || severity === 'error') {
    logger.error(fullMessage);
  } else {
    logger.info(fullMessage);
  }

  // Send to Discord
  if (config.alerts.discordWebhookUrl) {
    try {
      const color = severity === 'critical' ? 0xff0000 :
                    severity === 'error' ? 0xff6600 :
                    severity === 'warning' ? 0xffff00 : 0x00ff00;

      await axios.post(config.alerts.discordWebhookUrl, {
        embeds: [{
          title: `QuantaPool Oracle ${severity.toUpperCase()}`,
          description: message,
          color: color,
          timestamp: timestamp,
          footer: {
            text: 'QuantaPool Balance Oracle'
          }
        }]
      });
    } catch (e) {
      logger.warn(`Failed to send Discord alert: ${e.message}`);
    }
  }

  // Send to Telegram
  if (config.alerts.telegramBotToken && config.alerts.telegramChatId) {
    try {
      const emoji = severity === 'critical' ? '🚨' :
                    severity === 'error' ? '❌' :
                    severity === 'warning' ? '⚠️' : '✅';

      await axios.post(
        `https://api.telegram.org/bot${config.alerts.telegramBotToken}/sendMessage`,
        {
          chat_id: config.alerts.telegramChatId,
          text: `${emoji} *QuantaPool Oracle*\n\n${message}`,
          parse_mode: 'Markdown',
        }
      );
    } catch (e) {
      logger.warn(`Failed to send Telegram alert: ${e.message}`);
    }
  }
}

module.exports = { sendAlert };

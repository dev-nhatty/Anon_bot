
require('dotenv').config(); // Loads BOT_TOKEN from your .env file
const TelegramBot = require('node-telegram-bot-api');

// Get the bot token from .env
const token = process.env.BOT_TOKEN;

// create a new bot that uses 'polling' to fetch updates
const bot = new TelegramBot(token, { polling: true });

// confirming it's running
console.log("🤖 Bot is running...");

// Listen for any message
bot.on('message', (msg) => {
  const chatId = msg.chat.id; // The chat where the message came from
  const userMessage = msg.text; // What the user sent

  console.log(`Received message: ${userMessage}`);

  // Reply back to the user
  bot.sendMessage(chatId, `You said: ${userMessage}`);
});

// Respond to any text message
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  console.log(`Message from ${msg.from.username || msg.from.first_name}: ${text}`);

  bot.sendMessage(chatId, "Hello! I got your message 🤖");
});

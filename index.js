// ------------------------------
// 1️⃣ Setup & Imports
// ------------------------------
const TelegramBot = require("node-telegram-bot-api");
require("dotenv").config();

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// Replace this with your group chat ID (example: -1002345678901)
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;
const BOT_USERNAME = process.env.BOT_USERNAME; // e.g., 'MyAnonBot'

// Store temporary user drafts and comments
const userDrafts = {};
const postComments = {};

// ------------------------------
// 2️⃣ Helper Functions
// ------------------------------
function sendMainMenu(chatId) {
  bot.sendMessage(chatId, "Welcome! 👋 Choose an option:", {
    reply_markup: {
      keyboard: [
        [{ text: "📝 Post" }, { text: "ℹ️ Help" }],
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
}

function showHelp(chatId) {
  const text = `
📘 *Anonymous Posting Bot Help*

• *Post* → Create an anonymous post for the group.
• *Help* → See this help message.
• All posts remain anonymous.
• Only group members can post or comment.
  `;
  bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
}

async function checkGroupMembership(userId) {
  try {
    const member = await bot.getChatMember(GROUP_CHAT_ID, userId);
    return ["member", "administrator", "creator"].includes(member.status);
  } catch (e) {
    return false;
  }
}

// ------------------------------
// 3️⃣ Main Menu Logic
// ------------------------------
bot.onText(/\/start|Start/i, async (msg) => {
  const chatId = msg.chat.id;

  if (msg.chat.type !== "private") {
    // Redirect to private chat
    bot.sendMessage(
      chatId,
      `👋 Hi ${msg.from.first_name}, please continue anonymously here:\n👉 [Open Bot](https://t.me/${BOT_USERNAME}?start=start)`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  sendMainMenu(chatId);
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Ignore non-private messages except redirections
  if (msg.chat.type !== "private") return;

  if (text === "ℹ️ Help") {
    return showHelp(chatId);
  }

  if (text === "📝 Post") {
    const isMember = await checkGroupMembership(msg.from.id);
    if (!isMember) {
      return bot.sendMessage(
        chatId,
        "🚫 You must be a member of the group @ to post."
      );
    }

    userDrafts[msg.from.id] = "";
    return bot.sendMessage(chatId, "✏️ Please type your post message:", {
      reply_markup: {
        keyboard: [[{ text: "❌ Cancel" }]],
        resize_keyboard: true,
      },
    });
  }

  // Cancel option
  if (text === "❌ Cancel") {
    delete userDrafts[msg.from.id];
    return sendMainMenu(chatId);
  }

  // If user is typing a draft
  if (userDrafts[msg.from.id] !== undefined && text !== undefined) {
    userDrafts[msg.from.id] = text;

    return bot.sendMessage(chatId, "Here’s your post preview:", {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "✏️ Edit", callback_data: "edit_post" }],
          [{ text: "🖋️ Format", callback_data: "format_post" }],
          [{ text: "✅ Submit", callback_data: "submit_post" }],
          [{ text: "❌ Cancel", callback_data: "cancel_post" }],
        ],
      },
    });
  }
});

// ------------------------------
// 4️⃣ Handle Inline Button Actions
// ------------------------------
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;
  const draft = userDrafts[userId];

  if (!draft) return;

  switch (data) {
    case "edit_post":
      await bot.sendMessage(chatId, "✏️ Type your new message:");
      break;

    case "format_post":
      await bot.sendMessage(chatId, "🎨 Choose a text format:", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Bold", callback_data: "format_bold" }],
            [{ text: "Italic", callback_data: "format_italic" }],
            [{ text: "Code", callback_data: "format_code" }],
            [{ text: "Back", callback_data: "back_to_preview" }],
          ],
        },
      });
      break;

    case "back_to_preview":
      await bot.sendMessage(chatId, "Here’s your post preview again:", {
        text: draft,
        reply_markup: {
          inline_keyboard: [
            [{ text: "✏️ Edit", callback_data: "edit_post" }],
            [{ text: "🖋️ Format", callback_data: "format_post" }],
            [{ text: "✅ Submit", callback_data: "submit_post" }],
            [{ text: "❌ Cancel", callback_data: "cancel_post" }],
          ],
        },
      });
      break;

    case "submit_post":
      try {
        const post = await bot.sendMessage(GROUP_CHAT_ID, draft, {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "💬 Comment",
                  url: `https://t.me/${BOT_USERNAME}?start=comment_${query.from.id}`,
                },
              ],
            ],
          },
        });
        bot.sendMessage(chatId, "✅ Post submitted anonymously!");
        delete userDrafts[userId];
      } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, "❌ Failed to post. Try again.");
      }
      break;

    case "cancel_post":
      delete userDrafts[userId];
      sendMainMenu(chatId);
      break;

    case "format_bold":
    case "format_italic":
    case "format_code": {
      let formatted = draft;
      if (data === "format_bold") formatted = `*${draft}*`;
      if (data === "format_italic") formatted = `_${draft}_`;
      if (data === "format_code") formatted = `\`${draft}\``;

      userDrafts[userId] = formatted;

      await bot.sendMessage(chatId, "✨ Formatted Preview:", {
        parse_mode: "Markdown",
        text: formatted,
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Submit", callback_data: "submit_post" }],
            [{ text: "✏️ Edit", callback_data: "edit_post" }],
            [{ text: "🎨 Reformat", callback_data: "format_post" }],
            [{ text: "❌ Cancel", callback_data: "cancel_post" }],
          ],
        },
      });
      break;
    }
  }
});

// ------------------------------
// 5️⃣ Handle Comments (via /start comment_x)
// ------------------------------
bot.onText(/\/start comment_(.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const postId = match[1];

  if (!postComments[postId]) postComments[postId] = [];

  let comments = postComments[postId]
    .map((c) => `• ${c}`)
    .join("\n") || "No comments yet.";

  await bot.sendMessage(chatId, `🗨️ Comments:\n${comments}`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "➕ Add Comment", callback_data: `add_comment_${postId}` }],
        [{ text: "⬅️ Back", callback_data: "cancel_post" }],
      ],
    },
  });
});

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith("add_comment_")) {
    const postId = data.split("_")[2];
    bot.sendMessage(chatId, "💬 Type your comment:");
    userDrafts[chatId] = `commenting_${postId}`;
  }
});

bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (userDrafts[chatId] && userDrafts[chatId].startsWith("commenting_")) {
    const postId = userDrafts[chatId].split("_")[1];
    if (!postComments[postId]) postComments[postId] = [];
    postComments[postId].push(text);

    delete userDrafts[chatId];
    bot.sendMessage(chatId, "✅ Comment added anonymously!");
  }
});

// ------------------------------
// 6️⃣ Start Server
// ------------------------------
console.log("🤖 Bot is running...");

import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
dotenv.config();

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// In-memory data storage (use DB like MongoDB later for persistence)
const userSessions = {};
const posts = {}; // { messageId: { text, comments: [] } }

// Get bot username dynamically
let botUsername = "";
bot.getMe().then((me) => {
  botUsername = me.username;
  console.log(`🤖 Bot @${botUsername} is running...`);
});

// Commands setup (visible everywhere but they direct users to bot)
bot.setMyCommands([
  { command: "start", description: "Start using the bot" },
  { command: "post", description: "Create an anonymous post" },
  { command: "help", description: "Help on how to use the bot" },
]);

// START command
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  // Only interact privately
  if (msg.chat.type !== "private") {
    return bot.sendMessage(
      chatId,
      `👉 Please message me privately to start posting: https://t.me/${botUsername}`
    );
  }

  const opts = {
    reply_markup: {
      keyboard: [
        [{ text: "📝 Post" }, { text: "ℹ️ Help" }],
      ],
      resize_keyboard: true,
    },
  };
  bot.sendMessage(chatId, "Welcome! Choose an action:", opts);
});

// HELP command
bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  if (msg.chat.type !== "private") {
    return bot.sendMessage(chatId, `💬 Please use this command in private chat.`);
  }

  bot.sendMessage(
    chatId,
    `🤖 *Anonymous Posting Bot Help*\n\n📝 *Post* — Create a new anonymous post.\n✏️ *Edit* — Edit your message before submitting.\n🎨 *Format* — Choose formatting style.\n🚫 *Cancel* — Cancel current post.\n💬 *Comments* — Others can reply anonymously.`,
    { parse_mode: "Markdown" }
  );
});

// MAIN text listener
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Skip non-private chats
  if (msg.chat.type !== "private") return;

  const session = userSessions[chatId] || {};

  // Step 1: User clicks Post
  if (text === "📝 Post") {
    userSessions[chatId] = { step: "typing" };
    return bot.sendMessage(chatId, "✍️ Type your message below:", {
      reply_markup: {
        keyboard: [[{ text: "❌ Cancel" }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
  }

  // Cancel posting
  if (text === "❌ Cancel") {
    delete userSessions[chatId];
    return bot.sendMessage(chatId, "Cancelled ✅", {
      reply_markup: {
        keyboard: [[{ text: "📝 Post" }, { text: "ℹ️ Help" }]],
        resize_keyboard: true,
      },
    });
  }

  // Step 2: User types post content
  if (session.step === "typing") {
    userSessions[chatId] = { step: "confirming", text };
    return bot.sendMessage(chatId, `🕵️ Preview:\n\n${text}`, {
      reply_markup: {
        keyboard: [
          [{ text: "✏️ Edit" }, { text: "🎨 Format" }],
          [{ text: "🚫 Cancel" }, { text: "✅ Submit" }],
        ],
        resize_keyboard: true,
      },
    });
  }

  // Step 3: Edit text
  if (text === "✏️ Edit") {
    session.step = "typing";
    userSessions[chatId] = session;
    return bot.sendMessage(chatId, "Please retype your message:");
  }

  // Step 4: Format options
  if (text === "🎨 Format") {
    session.step = "formatting";
    userSessions[chatId] = session;
    return bot.sendMessage(chatId, "Choose a format:", {
      reply_markup: {
        keyboard: [
          [{ text: "Bold" }, { text: "Italic" }],
          [{ text: "Monospace" }, { text: "Back" }],
        ],
        resize_keyboard: true,
      },
    });
  }

  // Apply selected format
  if (["Bold", "Italic", "Monospace"].includes(text)) {
    const content = session.text || "";
    let formatted;

    if (text === "Bold") formatted = `*${content}*`;
    if (text === "Italic") formatted = `_${content}_`;
    if (text === "Monospace") formatted = "`" + content + "`";

    session.text = formatted;
    session.step = "confirming";
    userSessions[chatId] = session;

    return bot.sendMessage(chatId, `🔍 Preview with *${text}* format:\n\n${formatted}`, {
      parse_mode: "Markdown",
      reply_markup: {
        keyboard: [
          [{ text: "✏️ Edit" }, { text: "🎨 Format" }],
          [{ text: "🚫 Cancel" }, { text: "✅ Submit" }],
        ],
        resize_keyboard: true,
      },
    });
  }

  // Go back to preview from formatting
  if (text === "Back") {
    session.step = "confirming";
    userSessions[chatId] = session;
    return bot.sendMessage(chatId, `Back to preview:\n\n${session.text}`, {
      parse_mode: "Markdown",
    });
  }

  // Step 5: Submit
  if (text === "✅ Submit" && session.text) {
    const postText = session.text;
    const userId = msg.from.id;

    // Only allow group members to post
    try {
      const member = await bot.getChatMember(process.env.GROUP_CHAT_ID, userId);
      if (!["member", "administrator", "creator"].includes(member.status)) {
        return bot.sendMessage(chatId, "🚫 You must join the group first to post.");
      }
    } catch (e) {
      console.log("Membership check failed:", e);
      return bot.sendMessage(chatId, "⚠️ Unable to verify group membership.");
    }

// Send post to group first (without reply_markup)
const sent = await bot.sendMessage(process.env.GROUP_CHAT_ID, postText, {
  parse_mode: "Markdown",
});

// Then safely add the button using the real message_id
await bot.editMessageReplyMarkup(
  {
    inline_keyboard: [
      [
        { text: "💬 0 Comments", url: `https://t.me/${botUsername}?start=comment_${sent.message_id}` },
      ],
    ],
  },
  { chat_id: process.env.GROUP_CHAT_ID, message_id: sent.message_id }
);


    // Store post info
    posts[sent.message_id] = {
      text: postText,
      comments: [],
    };

    delete userSessions[chatId];

    return bot.sendMessage(chatId, "✅ Your anonymous post has been sent!");
  }
});
// COMMENT handler when users click “💬 Comment”
bot.onText(/\/start comment_(.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const messageId = match[1]; // Now using the actual message_id directly
  const post = posts[messageId];

  if (!post) {
    return bot.sendMessage(chatId, "⚠️ Sorry, this post no longer exists.");
  }

  // Ask user for comment
  await bot.sendMessage(chatId, `💬 Add your anonymous comment for this post:\n\n${post.text}\n\n(Type /cancel to stop)`);

  // Track that this user is commenting on this post
  userSessions[chatId] = { step: "commenting", messageId };
});

// Handle actual comment submission
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const session = userSessions[chatId];

  // Handle comment replies
  if (session && session.step === "commenting") {
    if (text === "/cancel") {
      delete userSessions[chatId];
      return bot.sendMessage(chatId, "🚫 Comment cancelled.");
    }

    const post = posts[session.messageId];
    if (!post) {
      delete userSessions[chatId];
      return bot.sendMessage(chatId, "⚠️ Sorry, this post no longer exists.");
    }

    post.comments.push(text);

    // Update comment count on group post
    const count = post.comments.length;
    await bot.editMessageReplyMarkup(
      {
        inline_keyboard: [
          [
            {
              text: `💬 ${count} Comments`,
              url: `https://t.me/${botUsername}?start=comment_${session.messageId}`,
            },
          ],
        ],
      },
      {
        chat_id: process.env.GROUP_CHAT_ID,
        message_id: session.messageId,
      }
    );

    delete userSessions[chatId];
    return bot.sendMessage(chatId, "✅ Comment added anonymously!");
  }
});

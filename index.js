import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
dotenv.config();

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// In-memory data storage (use DB like MongoDB later for persistence)
const userSessions = {};
const posts = {}; // { messageId: { text, comments: [] } }
const userReactions = {}; // { `${postId}_${commentIndex}_${userId}`: true }

// Get bot username dynamically
let botUsername = "";
bot.getMe().then((me) => {
  botUsername = me.username;
  console.log(`🤖 Bot @${botUsername} is running...`);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("⚠️ Unhandled Rejection:", reason);
});

// Commands setup (visible everywhere but they direct users to bot)
bot.setMyCommands([
  { command: "start", description: "Start using the bot" },
  { command: "post", description: "Create an anonymous post" },
  { command: "help", description: "Help on how to use the bot" },
]);

// When someone types /post or /help in the group, redirect them to the bot privately
bot.onText(/\/post|\/help/, async (msg) => {
  if (msg.chat.type !== "private") {
    return bot.sendMessage(
      msg.chat.id,
      `👉 Please use this command in private chat: https://t.me/${botUsername}`
    );
  }
});

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
  const messageId = match[1].trim();
  const post = posts[messageId];
  console.log("🔗 Comment requested for message:", messageId);

  if (!post) {
    return bot.sendMessage(chatId, "⚠️ Sorry, this post no longer exists.");
  }

  // Step 1: Show the main post first
  await bot.sendMessage(chatId, `🗣 *Post:*\n${post.text}`, { parse_mode: "Markdown" });

  // Step 2: Send all comments separately, each with reactions & reply buttons
  if (post.comments.length > 0) {
    for (let i = 0; i < post.comments.length; i++) {
      const comment = post.comments[i];
      await bot.sendMessage(chatId, `💭 *Comment ${i + 1}:*\n${comment.text}`, {

        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "👍 0", callback_data: `like_${messageId}_${i}` },
              { text: "❤️ 0", callback_data: `love_${messageId}_${i}` },
              { text: "😂 0", callback_data: `funny_${messageId}_${i}` },
            ],
            [{ text: "↩️ Reply", callback_data: `reply_${messageId}_${i}` }],
          ],
        },
      });
    }
  } else {
    await bot.sendMessage(chatId, "No comments yet. Be the first to comment!");
  }

  // Step 3: Ask user for new comment
  await bot.sendMessage(chatId, "💬 Type your anonymous comment below or /cancel to stop.");

  // Step 4: Track comment session
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

    // Handle threaded replies
  if (session && session.step === "replying") {
    const { messageId, commentIndex } = session;
    const post = posts[messageId];
    const comment = post?.comments[commentIndex];

    if (!comment) {
      delete userSessions[chatId];
      return bot.sendMessage(chatId, "⚠️ Comment no longer exists.");
    }

    if (text === "/cancel") {
      delete userSessions[chatId];
      return bot.sendMessage(chatId, "🚫 Reply cancelled.");
    }

    // Save reply
    comment.replies = comment.replies || [];
    comment.replies.push(text);

    delete userSessions[chatId];

    await bot.sendMessage(chatId, "✅ Reply added anonymously!");

    // Display threaded reply right under the comment
    await bot.sendMessage(chatId, `↪️ *Reply to Comment ${commentIndex + 1}:*\n${text}`, {
      parse_mode: "Markdown",
    });
  }


    const post = posts[session.messageId];
    if (!post) {
      delete userSessions[chatId];
      return bot.sendMessage(chatId, "⚠️ Sorry, this post no longer exists.");
    }

    post.comments.push({ text, reactions: { like: 0, love: 0, funny: 0 }, replies: [] });
    console.log(`📝 New comment added to post ${session.messageId}:`, text);

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

// 🧩 Fix: Handle actual reply submissions (separate from comments)
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const session = userSessions[chatId];

  if (session && session.step === "replying") {
    const { messageId, commentIndex } = session;
    const post = posts[messageId];
    const comment = post?.comments[commentIndex];

    if (!comment) {
      delete userSessions[chatId];
      return bot.sendMessage(chatId, "⚠️ Comment no longer exists.");
    }

    if (text === "/cancel") {
      delete userSessions[chatId];
      return bot.sendMessage(chatId, "🚫 Reply cancelled.");
    }

    // Save reply
    comment.replies = comment.replies || [];
    comment.replies.push({ text });

    delete userSessions[chatId];

    await bot.sendMessage(chatId, "✅ Reply added anonymously!");
    await bot.sendMessage(
      chatId,
      `↪️ *Reply to Comment ${commentIndex + 1}:*\n${text}`,
      { parse_mode: "Markdown" }
    );
  }
});

  // Handle reactions and threaded replies
bot.on("callback_query", async (query) => {
  const { data, message } = query;
  if (!data) return;

  const chatId = message.chat.id;
  const [action, postId, commentIndex] = data.split("_");
  const post = posts[postId];

  if (!post || !post.comments[commentIndex]) {
    return bot.answerCallbackQuery(query.id, { text: "❌ Comment no longer exists." });
  }

  const comment = post.comments[commentIndex];

  // --- Reaction handling (independent toggle) ---
  if (["like", "love", "funny"].includes(action)) {
    const idx = Number(commentIndex);
    if (Number.isNaN(idx)) {
      return bot.answerCallbackQuery(query.id, { text: "Invalid comment index." });
    }

    // Ensure post and comment exist
    if (!posts[postId] || !posts[postId].comments[idx]) {
      return bot.answerCallbackQuery(query.id, { text: "Comment no longer exists." });
    }

    const commentObj = posts[postId].comments[idx];

    // Initialize reactions and user reaction tracking
    commentObj.reactions = commentObj.reactions || { like: 0, love: 0, funny: 0 };
    commentObj.userReactions = commentObj.userReactions || {}; // userReactions[userId] = { like: true, love: false, ... }

    const userId = query.from.id;
    commentObj.userReactions[userId] = commentObj.userReactions[userId] || {};

    // Toggle the selected reaction independently
    const alreadyReacted = commentObj.userReactions[userId][action];

    if (alreadyReacted) {
      commentObj.reactions[action] = Math.max((commentObj.reactions[action] || 1) - 1, 0);
      commentObj.userReactions[userId][action] = false;
      await bot.answerCallbackQuery(query.id, { text: `❌ Removed your ${action} reaction` });
    } else {
      commentObj.reactions[action] = (commentObj.reactions[action] || 0) + 1;
      commentObj.userReactions[userId][action] = true;
      await bot.answerCallbackQuery(query.id, { text: `✅ Added your ${action} reaction` });
    }

    // Update the inline keyboard with new counts
    const { like, love, funny } = commentObj.reactions;

    try {
      await bot.editMessageReplyMarkup(
        {
          inline_keyboard: [
            [
              { text: `👍 ${like}`, callback_data: `like_${postId}_${idx}` },
              { text: `❤️ ${love}`, callback_data: `love_${postId}_${idx}` },
              { text: `😂 ${funny}`, callback_data: `funny_${postId}_${idx}` },
            ],
            [{ text: "↩️ Reply", callback_data: `reply_${postId}_${idx}` }],
          ],
        },
        {
          chat_id: message.chat.id,
          message_id: message.message_id,
        }
      );
    } catch (err) {
      console.error("Failed to update reactions:", err.message);
    }

    return;
  }

  // --- Reply handling ---
  if (action === "reply") {
    userSessions[chatId] = {
      step: "replying",
      messageId: postId,
      commentIndex: parseInt(commentIndex),
    };

    await bot.sendMessage(chatId, "💬 Type your reply to this comment (or /cancel to stop):");
    return bot.answerCallbackQuery(query.id);
  }
});
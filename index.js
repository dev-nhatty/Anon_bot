import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
dotenv.config();
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const POSTS_FILE = path.join(DATA_DIR, "posts.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadPosts() {
  try {
    ensureDataDir();
    if (!fs.existsSync(POSTS_FILE)) {
      fs.writeFileSync(POSTS_FILE, JSON.stringify({}, null, 2), "utf8");
      return {};
    }
    const raw = fs.readFileSync(POSTS_FILE, "utf8");
    return JSON.parse(raw || "{}");
  } catch (err) {
    console.error("Failed to load posts.json:", err);
    return {};
  }
}

function savePostsSync() {
  try {
    ensureDataDir();
    // atomic-ish write: write to tmp then rename
    const tmp = POSTS_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(posts, null, 2), "utf8");
    fs.renameSync(tmp, POSTS_FILE);
  } catch (err) {
    console.error("Failed to save posts.json:", err);
  }
}

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const userSessions = {};
let posts = loadPosts(); 
const userReactions = {}; // { `${postId}_${commentIndex}_${userId}`: true }

//Mapped topic buttons to Telegram topic IDs
const GROUP_TOPICS = {
  discussion1: { id: 170, label: "Discussion 1" },
  discussion2: { id: 171, label: "Discussion 2" },
  discussion3: { id: 172, label: "Discussion 3" },
};

// Get bot username dynamically
let botUsername = "";
bot.getMe().then((me) => {
  botUsername = me.username;
  console.log(`🤖 Bot @${botUsername} is running...`);
  (async () => {
    try {
      // message text shown in group
      const groupText = `🔗 የመልእክት መጻፊያውን ቦት ይክፈቱ`;

      // deep link to open the bot privately (no payload)
      const botDeepLink = `https://t.me/${botUsername}`;

      // Send the link message to the group (only sends once on startup)
      let sent;
      sent = await bot.sendMessage(process.env.GROUP_CHAT_ID, groupText, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "📣", url: botDeepLink }]
          ]
        },
      });

      try {
        await bot.pinChatMessage(process.env.GROUP_CHAT_ID, sent.message_id, { disable_notification: true });
        console.log("Pinned bot link message in group.");
      } catch (pinErr) {
        // ignore pin errors (bot might not be admin)
        console.log("Could not pin message (needs admin rights):", pinErr.message);
      }
    } catch (err) {
      console.error("Failed to send bot link message to group:", err.message || err);
    }
  })();
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
  bot.sendMessage(chatId, "እንኳን ደህና መጡ! ከታች ካሉት አማራጮች ይምረጡ፦", opts);
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
    return bot.sendMessage(chatId, "✍️ መልዕክትዎን ከታች ያስገቡ፦", {
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
    if (msg.chat.type === "private") {
  return bot.sendMessage(chatId, "Cancelled ✅", {
    reply_markup: {
      keyboard: [[{ text: "📝 Post" }, { text: "ℹ️ Help" }]],
      resize_keyboard: true,
    },
  });
} else {
  return bot.sendMessage(chatId, "Cancelled ✅"); // no buttons in groups
}
  }

  // Handle media uploads (photos, videos, GIFs, stickers, docs)
if (session.step === "typing" && (
  msg.photo || msg.video || msg.animation || msg.sticker || msg.document
)) {
  let fileId, fileType;

  if (msg.photo) {
    fileId = msg.photo[msg.photo.length - 1].file_id;
    fileType = "photo";
  } else if (msg.video) {
    fileId = msg.video.file_id;
    fileType = "video";
  } else if (msg.animation) {
    fileId = msg.animation.file_id;
    fileType = "animation";
  } else if (msg.sticker) {
    fileId = msg.sticker.file_id;
    fileType = "sticker";
  } else if (msg.document) {
    fileId = msg.document.file_id;
    fileType = "document";
  }

  userSessions[chatId] = { step: "captioning", fileId, fileType };

  return bot.sendMessage(chatId, `📝 መግለጫ(caption) ያስገቡ (ወይም ‘Skip’ ብለው ይቀጥሉ):`, {
    reply_markup: {
      keyboard: [[{ text: "❌ Cancel" }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
}

// Handle caption input
if (session.step === "captioning") {
  const caption = text === "Skip" ? "" : text;
  session.caption = caption;
  session.step = "confirming";
  userSessions[chatId] = session;

  return bot.sendMessage(
    chatId,
    `🕵️ Preview:\n📎 Media: ${session.fileType}\n🗒 Caption: ${caption || "(none)"}`,
    {
      reply_markup: {
        keyboard: [
          [{ text: "✏️ Edit Caption" }, { text: "🚫 Cancel" }],
          [{ text: "✅ Submit" }],
        ],
        resize_keyboard: true,
      },
    }
  );
}

  // Step 2: User types post content
  if (session.step === "typing") {
    userSessions[chatId] = { step: "choose_topic", text };
  
    return bot.sendMessage(chatId, "📌 መልዕክቱ ወደ የትኛው ርዕስ (Topic) ይላክ?", {
      reply_markup: {
        keyboard: [
          [{ text: GROUP_TOPICS.discussion1.label }],
          [{ text: GROUP_TOPICS.discussion2.label }],
          [{ text: GROUP_TOPICS.discussion3.label }],
          [{ text: "🚫 Cancel" }],
        ],
        resize_keyboard: true,
      },
    });
  }
  
  if (session.step === "choose_topic") {
    const topicEntry = Object.values(GROUP_TOPICS)
      .find(t => t.label === text);
  
    if (!topicEntry) {
      return bot.sendMessage(chatId, "⚠️ እባክዎ ከታች ካሉት ርዕሶች አንዱን ይምረጡ።");
    }
  
    session.topicId = topicEntry.id;
    session.step = "confirming";
    userSessions[chatId] = session;
  
    return bot.sendMessage(chatId, `🕵️ Preview:\n\n${session.text}`, {
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
    return bot.sendMessage(chatId, "መልዕክትዎን እንደገና ይጻፉ፦");
  }

  // Step 4: Format options
  if (text === "🎨 Format") {
    session.step = "formatting";
    userSessions[chatId] = session;
    return bot.sendMessage(chatId, "ፎርማት ይምረጡ፦", {
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
  if (text === "✅ Submit" && (session.text || session.fileId)) {
    const postText = session.text;
    const userId = msg.from.id;
    let sent;

    // Only allow group members to post
    try {
      const member = await bot.getChatMember(process.env.GROUP_CHAT_ID, userId);
      if (!["member", "administrator", "creator"].includes(member.status)) {
        return bot.sendMessage(chatId, "🚫 መልዕክት ለመላክ የቡድኑ አባል መሆን አለብዎት።");
      }
    } catch (e) {
      console.log("Membership check failed:", e);
      return bot.sendMessage(chatId, "⚠️ Unable to verify group membership.");
    }
    
    // Handle media post sending
if (session.fileId) {
  const userId = msg.from.id;

  try {
    const member = await bot.getChatMember(process.env.GROUP_CHAT_ID, userId);
    if (!["member", "administrator", "creator"].includes(member.status)) {
      return bot.sendMessage(chatId, "🚫 መልዕክት ለመላክ የቡድኑ አባል መሆን አለብዎት።");
    }
  } catch (e) {
    console.log("Membership check failed:", e);
    return bot.sendMessage(chatId, "⚠️ Unable to verify group membership.");
  }

  // Send media to group
  let sent;
const caption = session.caption || "";

switch (session.fileType) {
  case "photo":
    sent = await bot.sendPhoto(
      process.env.GROUP_CHAT_ID,
      session.fileId,
      {
        caption,
        message_thread_id: session.topicId,
      }
    );    
    break;
  case "video":
    sent = await bot.sendVideo(
      process.env.GROUP_CHAT_ID,
      session.fileId,
      {
        caption,
        message_thread_id: session.topicId,
      }
    );
    break;

    case "animation":
      sent = await bot.sendAnimation(
        process.env.GROUP_CHAT_ID,
        session.fileId,
        {
          caption,
          message_thread_id: session.topicId,
        }
      );      
      break;
    case "sticker":
      sent = await bot.sendSticker(
        process.env.GROUP_CHAT_ID,
        session.fileId,
        {
          caption,
          message_thread_id: session.topicId,
        }
      );     
      break;
    case "document":
      sent = await bot.sendDocument(
        process.env.GROUP_CHAT_ID,
        session.fileId,
        {
          caption,
          message_thread_id: session.topicId,
        }
      );  
      break;
  }

  await bot.editMessageReplyMarkup(
    {
      inline_keyboard: [
        [{ text: "💬 0 Comments", url: `https://t.me/${botUsername}?start=comment_${sent.message_id}` }],
      ],
    },
    { chat_id: process.env.GROUP_CHAT_ID, message_id: sent.message_id }
  );

  posts[sent.message_id] = {
    media: { type: session.fileType, id: session.fileId },
    comments: [],
  };
  savePostsSync();

  delete userSessions[chatId];
  return bot.sendMessage(chatId, `ጥያቄዎን ስላስቀመጡልን እናመሰናለን። \n
  ለጥያቄዎ የሚሰጠውን ምላሽ ወደ ቅዱስ ጴጥሮስ ግቢ ጉባኤ ዕቅበተ እምነት ክፍል Telegram Group በመግባት ይመልከቱ። 👉 https://t.me/+WeK2gqmH23xkODdk \n
  “በእናንተ ስላለ ተስፋ ምክንያትን ለሚጠይቁዋችሁ ሁሉ መልስ ለመስጠት ዘወትር የተዘጋጃችሁ ሁኑ፥ ነገር ግን በየዋህነትና በፍርሃት ይሁን።” — 1 ጴጥሮስ 3:15`);
}

    // Send post to group first (without reply_markup)
    sent = await bot.sendMessage(process.env.GROUP_CHAT_ID, postText, {
  message_thread_id: session.topicId,
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
      topicId: session.topicId,
      comments: [],
    };    
    savePostsSync();

    delete userSessions[chatId];

    return bot.sendMessage(chatId, `ጥያቄዎን ስላስቀመጡልን እናመሰናለን። \n
    ለጥያቄዎ የሚሰጠውን ምላሽ ወደ ቅዱስ ጴጥሮስ ግቢ ጉባኤ ዕቅበተ እምነት ክፍል Telegram Group በመግባት ይመልከቱ። 👉 https://t.me/+WeK2gqmH23xkODdk \n
    “በእናንተ ስላለ ተስፋ ምክንያትን ለሚጠይቁዋችሁ ሁሉ መልስ ለመስጠት ዘወትር የተዘጋጃችሁ ሁኑ፥ ነገር ግን በየዋህነትና በፍርሃት ይሁን።” — 1 ጴጥሮስ 3:15`);
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

  // Step 1: Show the main post first (text or media)
if (post.text) {
  await bot.sendMessage(chatId, `🗣 *Post:*\n${post.text}`, { parse_mode: "Markdown" });
} else if (post.media) {
  const { type, id } = post.media;
  const caption = post.caption || "";

  switch (type) {
    case "photo":
      await bot.sendPhoto(chatId, id, { caption, parse_mode: "Markdown" });
      break;
    case "video":
      await bot.sendVideo(chatId, id, { caption, parse_mode: "Markdown" });
      break;
    case "animation":
      await bot.sendAnimation(chatId, id, { caption, parse_mode: "Markdown" });
      break;
    case "sticker":
      await bot.sendSticker(chatId, id);
      break;
    case "document":
      await bot.sendDocument(chatId, id, { caption, parse_mode: "Markdown" });
      break;
    default:
      await bot.sendMessage(chatId, "⚠️ (Unsupported media type)");
  }
}

  // Step 2: Send all comments separately, each with reactions & reply buttons
  if (post.comments.length > 0) {
    for (let i = 0; i < post.comments.length; i++) {
      const comment = post.comments[i];

  // Send the main comment
  const sentComment = await bot.sendMessage(
    chatId,
    `💭 *Comment ${i + 1}:*\n${comment.text}`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: `❤️ ${comment.reactions?.love || 0}`, callback_data: `love_${messageId}_${i}` },
            { text: `🙌 ${comment.reactions?.support || 0}`, callback_data: `support_${messageId}_${i}` },
            { text: `🙏 ${comment.reactions?.amen || 0}`, callback_data: `amen_${messageId}_${i}` },
          ],
          [
            { text: `🤝 ${comment.reactions?.agree || 0}`, callback_data: `agree_${messageId}_${i}` },
            { text: `🙅 ${comment.reactions?.disagree || 0}`, callback_data: `disagree_${messageId}_${i}` },
          ],
          [{ text: "↩️ Reply", callback_data: `reply_${messageId}_${i}` }],
        ],
      },
    }
  );

  // Then send replies as separate messages under the comment
  if (comment.replies && comment.replies.length > 0) {
    for (let j = 0; j < comment.replies.length; j++) {
      const reply = comment.replies[j];
      await bot.sendMessage(
        chatId,
        `↪️ *Reply ${j + 1}:* ${reply.text || reply}`,
        {
          parse_mode: "Markdown",
          reply_to_message_id: sentComment.message_id,
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: `👍 ${reply.reactions?.like || 0}`,
                  callback_data: `replylike_${messageId}_${i}_${j}`,
                },
                {
                  text: `❤️ ${reply.reactions?.love || 0}`,
                  callback_data: `replylove_${messageId}_${i}_${j}`,
                },
                {
                  text: `😂 ${reply.reactions?.funny || 0}`,
                  callback_data: `replyfunny_${messageId}_${i}_${j}`,
                },
              ],
            ],
          },
        }
      );
    }
  }
}


  } else {
    await bot.sendMessage(chatId, "እስካሁን ድረስ ምንም አስተያየት አልተሰጠም። የመጀመሪያውን አስተያየት ማቅረብ ይችላሉ።");
  }

  // Step 3: Ask user for new comment
  await bot.sendMessage(chatId, "💬 አስተያየትዎን ከታች ይፃፉ ወይም /cancel ብለው ሂደቱን ያቁሙ።");

  // Step 4: Track comment session
  userSessions[chatId] = { step: "commenting", messageId };
});



// Handle actual comment submission
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const session = userSessions[chatId] || {};

  // Handle comment replies
  if (session && session.step === "commenting") {
    if (text === "/cancel") {
      delete userSessions[chatId];
      return bot.sendMessage(chatId, "🚫 አስተያየት የመፃፍ ሂደቱ ተቋርጧል።");
    }

    // Handle threaded replies
  if (session && session.step === "replying") {
    const { messageId, commentIndex } = session;
    const post = posts[messageId];
    const comment = post?.comments[commentIndex];

    if (!comment) {
      delete userSessions[chatId];
      return bot.sendMessage(chatId, "⚠️ ይቅርታ፣ ይህ አስተያየት አልተገኘም።");
    }

    if (text === "/cancel") {
      delete userSessions[chatId];
      return bot.sendMessage(chatId, "🚫 መልስ የመፃፍ ሂደቱ ተቋርጧል።");
    }

    // Save reply
    comment.replies = comment.replies || [];
    comment.replies.push(text);

    delete userSessions[chatId];

    await bot.sendMessage(chatId, "✅ መልስዎ በተሳካ ሁኔታ ተልኳል።")

    // Display threaded reply right under the comment
    await bot.sendMessage(chatId, `↪️ *Reply to Comment ${commentIndex + 1}:*\n${text}`, {
      parse_mode: "Markdown",
    });
  }


    const post = posts[session.messageId];
    if (!post) {
      delete userSessions[chatId];
      return bot.sendMessage(chatId, "⚠️ ይቅርታ፣ ይህ አስተያየት አልተገኘም።");
    }

    post.comments.push({ text, reactions: { like: 0, love: 0, funny: 0 }, replies: [] });
    savePostsSync();
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
    return bot.sendMessage(chatId, "✅ አስተያየትዎ በተሳካ ሁኔታ ተልኳል፣ እናመሰግናለን።)");
  }
});

// Fix: Handle actual reply submissions (separate from comments)
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
      return bot.sendMessage(chatId, "⚠️ ይቅርታ፣ ይህ አስተያየት አልተገኘም።");
    }

    if (text === "/cancel") {
      delete userSessions[chatId];
      return bot.sendMessage(chatId, "🚫 መልስ የመፃፍ ሂደቱ ተቋርጧል።");
    }

    // Save reply
    comment.replies = comment.replies || [];
    comment.replies.push({ text });
    savePostsSync();
    delete userSessions[chatId];

    await bot.sendMessage(chatId, "✅ መልስዎ በተሳካ ሁኔታ ተልኳል።");
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
    return bot.answerCallbackQuery(query.id, { text: "❌ ይቅርታ፣ ይህ ፖስት አልተገኘም።" });
  }

  const comment = post.comments[commentIndex];

  // --- Reaction handling (allow multiple different reactions per user, toggled independently) ---
  if (["love", "support", "amen", "agree", "disagree"].includes(action)) {
    const idx = Number(commentIndex);
    if (Number.isNaN(idx)) {
      return bot.answerCallbackQuery(query.id, { text: "Invalid comment index." });
    }

    // Ensure post and comment exist
    if (!posts[postId] || !posts[postId].comments[idx]) {
      return bot.answerCallbackQuery(query.id, { text: "⚠️ ይቅርታ፣ ይህ አስተያየት አልተገኘም።" });
    }

    const commentObj = posts[postId].comments[idx];

    // Make sure reaction buckets exist
    commentObj.reactions = commentObj.reactions || { love: 0, support: 0, amen: 0, agree: 0, disagree: 0 };
    commentObj.userReactions = commentObj.userReactions || {}; // map userId -> { love: true, agree: false, ... }

    const userId = String(query.from.id); // use string keys to be safe
    const userMap = commentObj.userReactions[userId] || {};

    const alreadyReacted = !!userMap[action];

    if (alreadyReacted) {
      // remove this specific reaction only
      commentObj.reactions[action] = Math.max((commentObj.reactions[action] || 1) - 1, 0);
      userMap[action] = false;
      await bot.answerCallbackQuery(query.id, { text: `❌ Removed your ${action} reaction` });
    } else {
      // add this specific reaction only
      commentObj.reactions[action] = (commentObj.reactions[action] || 0) + 1;
      userMap[action] = true;
      await bot.answerCallbackQuery(query.id, { text: `✅ Added your ${action} reaction` });
    }

    // persist per-user map back
    commentObj.userReactions[userId] = userMap;

    // Update the inline keyboard with new counts
    const { love, support, amen, agree, disagree } = commentObj.reactions;

    try {
      await bot.editMessageReplyMarkup(
        {
          inline_keyboard: [
            [
              { text: `❤️ ${love}`, callback_data: `love_${postId}_${idx}` },
              { text: `🙌 ${support}`, callback_data: `support_${postId}_${idx}` },
              { text: `🙏 ${amen}`, callback_data: `amen_${postId}_${idx}` },
            ],
            [
              { text: `🤝 ${agree}`, callback_data: `agree_${postId}_${idx}` },
              { text: `🙅 ${disagree}`, callback_data: `disagree_${postId}_${idx}` },
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
  
  // --- Reply reaction handling (allow multiple different reactions per user on replies) ---
  if (["replylove", "replysupport", "replyamen", "replyagree", "replydisagree"].some(a => data.startsWith(a))) {
    const [fullAction, postIdR, commentIndexR, replyIndexR] = data.split("_");
    const baseAction = fullAction.replace("reply", ""); // e.g. "love", "support"

    const comment = posts[postIdR]?.comments?.[commentIndexR];
    const reply = comment?.replies?.[replyIndexR];

    if (!reply) {
      return bot.answerCallbackQuery(query.id, { text: "❌ Reply no longer exists." });
    }

    // Initialize reaction data
    reply.reactions = reply.reactions || { love: 0, support: 0, amen: 0, agree: 0, disagree: 0 };
    reply.userReactions = reply.userReactions || {}; // map userId -> { love: true, ... }

    const userId = String(query.from.id);
    const userMap = reply.userReactions[userId] || {};

    const alreadyReacted = !!userMap[baseAction];

    if (alreadyReacted) {
      reply.reactions[baseAction] = Math.max((reply.reactions[baseAction] || 1) - 1, 0);
      userMap[baseAction] = false;
      await bot.answerCallbackQuery(query.id, { text: `❌ Removed your ${baseAction} reaction` });
    } else {
      reply.reactions[baseAction] = (reply.reactions[baseAction] || 0) + 1;
      userMap[baseAction] = true;
      await bot.answerCallbackQuery(query.id, { text: `✅ Added your ${baseAction} reaction` });
    }

    reply.userReactions[userId] = userMap;

    const { love, support, amen, agree, disagree } = reply.reactions;

    try {
      await bot.editMessageReplyMarkup(
        {
          inline_keyboard: [
            [
              { text: `❤️ ${love}`, callback_data: `replylove_${postIdR}_${commentIndexR}_${replyIndexR}` },
              { text: `🙌 ${support}`, callback_data: `replysupport_${postIdR}_${commentIndexR}_${replyIndexR}` },
              { text: `🙏 ${amen}`, callback_data: `replyamen_${postIdR}_${commentIndexR}_${replyIndexR}` },
            ],
            [
              { text: `🤝 ${agree}`, callback_data: `replyagree_${postIdR}_${commentIndexR}_${replyIndexR}` },
              { text: `🙅 ${disagree}`, callback_data: `replydisagree_${postIdR}_${commentIndexR}_${replyIndexR}` },
            ],
          ],
        },
        {
          chat_id: message.chat.id,
          message_id: message.message_id,
        }
      );
    } catch (err) {
      console.error("Failed to update reply reactions:", err.message);
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

    await bot.sendMessage(chatId, "💬 ለዚህ አስተያየት መልስ ለመስጠት የሚፈልጉትን ይጻፉ (ወይም /cancel በመጠቀም ይቁሙ)፦");
    return bot.answerCallbackQuery(query.id);
  }
})
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
    return bot.sendMessage(chatId, "Cancelled ✅", {
      reply_markup: {
        keyboard: [[{ text: "📝 Post" }, { text: "ℹ️ Help" }]],
        resize_keyboard: true,
      },
    });
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
    sent = await bot.sendPhoto(process.env.GROUP_CHAT_ID, session.fileId, { caption });
    break;
  case "video":
    sent = await bot.sendVideo(process.env.GROUP_CHAT_ID, session.fileId, { caption });
    break;

    case "animation":
      sent = await bot.sendAnimation(process.env.GROUP_CHAT_ID, session.fileId);
      break;
    case "sticker":
      sent = await bot.sendSticker(process.env.GROUP_CHAT_ID, session.fileId);
      break;
    case "document":
      sent = await bot.sendDocument(process.env.GROUP_CHAT_ID, session.fileId);
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

  delete userSessions[chatId];
  return bot.sendMessage(chatId, `ጥያቄዎን ስላስቀመጡልን እናመሰናለን። \n
  ለጥያቄዎ የሚሰጠውን ምላሽ ወደ ቅዱስ ጴጥሮስ ግቢ ጉባኤ ዕቅበተ እምነት ክፍል Telegram Group በመግባት ይመልከቱ። 👉 https://t.me/+WeK2gqmH23xkODdk \n
  “በእናንተ ስላለ ተስፋ ምክንያትን ለሚጠይቁዋችሁ ሁሉ መልስ ለመስጠት ዘወትር የተዘጋጃችሁ ሁኑ፥ ነገር ግን በየዋህነትና በፍርሃት ይሁን።” — 1 ጴጥሮስ 3:15`);
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
          reply_to_message_id: sentComment.message_id, // ensures it's visually nested under the comment
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

  // --- Reaction handling (independent toggle) ---
  if (["love", "support", "amen", "agree", "disagree"].includes(action)) {
    const idx = Number(commentIndex);
    if (Number.isNaN(idx)) {
      return bot.answerCallbackQuery(query.id, { text: "Invalid comment index." });
    }

    // Ensure post and comment exist
    if (!posts[postId] || !posts[postId].comments[idx]) {
      return bot.answerCallbackQuery(query.id, { text: "ይቅርታ፣ ይህ አስተያየት አልተገኘም።" });
    }

    const commentObj = posts[postId].comments[idx];

    // Initialize reactions and user reaction tracking
    commentObj.reactions = commentObj.reactions || { love: 0, support: 0, amen: 0, agree: 0, disagree: 0 };
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
  
    // --- Reply Reaction handling (like/love/funny on replies) ---
  if (["replylove", "replysupport", "replyamen", "replyagree", "replydisagree"].some(a => data.startsWith(a))) {
    const [fullAction, postId, commentIndex, replyIndex] = data.split("_");
    const baseAction = fullAction.replace("reply", ""); // "like", "love", "funny"

    const comment = posts[postId]?.comments?.[commentIndex];
    const reply = comment?.replies?.[replyIndex];

    if (!reply) {
      return bot.answerCallbackQuery(query.id, { text: "❌ ይቅርታ፣ ይህ መልስ አልተገኘም።" });
    }

    // Initialize reaction data
    reply.reactions = reply.reactions || { love: 0, support: 0, amen: 0, agree: 0, disagree: 0 };
    reply.userReactions = reply.userReactions || {};

    const userId = query.from.id;
    reply.userReactions[userId] = reply.userReactions[userId] || {};

    const alreadyReacted = reply.userReactions[userId][baseAction];

    // Toggle the selected reaction independently
    if (alreadyReacted) {
      reply.reactions[baseAction] = Math.max((reply.reactions[baseAction] || 1) - 1, 0);
      reply.userReactions[userId][baseAction] = false;
      await bot.answerCallbackQuery(query.id, { text: `❌ Removed your ${baseAction} reaction` });
    } else {
      reply.reactions[baseAction] = (reply.reactions[baseAction] || 0) + 1;
      reply.userReactions[userId][baseAction] = true;
      await bot.answerCallbackQuery(query.id, { text: `✅ Added your ${baseAction} reaction` });
    }

    const { love, support, amen, agree, disagree } = reply.reactions;

    // Update inline keyboard with new counts
    try {
      await bot.editMessageReplyMarkup(
        {
          inline_keyboard: [
            [
              { text: `❤️ ${love}`, callback_data: `replylove_${postId}_${commentIndex}_${replyIndex}` },
              { text: `🙌 ${support}`, callback_data: `replysupport_${postId}_${commentIndex}_${replyIndex}` },
              { text: `🙏 ${amen}`, callback_data: `replyamen_${postId}_${commentIndex}_${replyIndex}` },
            ],
            [
              { text: `🤝 ${agree}`, callback_data: `replyagree_${postId}_${commentIndex}_${replyIndex}` },
              { text: `🙅 ${disagree}`, callback_data: `replydisagree_${postId}_${commentIndex}_${replyIndex}` },
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
});
/**
 * Best-effort Telegram notification. Never throws — a failed notification
 * must never break the caller's flow (e.g. signup/provisioning).
 */
export async function notifyTelegram(text: string): Promise<void> {
  const token = process.env.TG_TOKEN;
  const chatId = process.env.TG_CHAT;

  if (!token || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (error) {
    console.error('notifyTelegram: failed to send notification:', error);
  }
}

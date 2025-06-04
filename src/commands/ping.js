module.exports = async function ping(ctx) {
  try {
    await ctx.reply('pong');
  } catch (err) {
    console.error('Ping command error:', err.message);
  }
};

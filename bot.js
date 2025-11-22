const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// ═══════════════════════════════════════════════════════════
// 🤖 BOT CONFIGURATION
// ═══════════════════════════════════════════════════════════

const token = 'YOUR_BOT_TOKEN_HERE';
const bot = new TelegramBot(token, { polling: true });

const BINANCE_API = 'https://fapi.binance.com';
const INITIAL_BALANCE = 10000;
const MAX_LEVERAGE = 125;
const COMMISSION_RATE = 0.0004; // 0.04% per trade

console.log('🚀 Futures Demo Trading Bot V2 Started!');

// ═══════════════════════════════════════════════════════════
// 💾 DATA STORAGE
// ═══════════════════════════════════════════════════════════

const users = new Map();
const userStates = new Map();

// ═══════════════════════════════════════════════════════════
// 🔧 UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════

function initUser(userId) {
  if (!users.has(userId)) {
    users.set(userId, {
      balance: INITIAL_BALANCE,
      positions: [],
      orders: [], // Pending TP/SL orders
      tradeHistory: [],
      stats: {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        totalProfit: 0,
        totalLoss: 0,
        bestTrade: 0,
        worstTrade: 0,
        totalCommission: 0
      },
      settings: {
        autoTP: false,
        autoSL: false,
        defaultTP: 10, // 10%
        defaultSL: 5,  // 5%
        notifications: true
      }
    });
  }
  return users.get(userId);
}

const formatNumber = (num, decimals = 2) => {
  return parseFloat(num).toFixed(decimals);
};

const formatVolume = (num) => {
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toFixed(2);
};

const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit' 
  });
};

// ═══════════════════════════════════════════════════════════
// 📊 BINANCE API FUNCTIONS
// ═══════════════════════════════════════════════════════════

async function getCoinPrice(symbol) {
  try {
    symbol = symbol.toUpperCase();
    if (!symbol.endsWith('USDT')) symbol += 'USDT';
    
    const response = await axios.get(`${BINANCE_API}/fapi/v1/ticker/price`, {
      params: { symbol }
    });
    
    return {
      symbol: response.data.symbol,
      price: parseFloat(response.data.price)
    };
  } catch (error) {
    throw new Error(`❌ Invalid symbol: ${symbol}`);
  }
}

async function getCoinDetails(symbol) {
  try {
    symbol = symbol.toUpperCase();
    if (!symbol.endsWith('USDT')) symbol += 'USDT';

    const [priceRes, statsRes] = await Promise.all([
      axios.get(`${BINANCE_API}/fapi/v1/ticker/price`, { params: { symbol } }),
      axios.get(`${BINANCE_API}/fapi/v1/ticker/24hr`, { params: { symbol } })
    ]);

    return {
      symbol: priceRes.data.symbol,
      price: parseFloat(priceRes.data.price),
      priceChange: parseFloat(statsRes.data.priceChange),
      priceChangePercent: parseFloat(statsRes.data.priceChangePercent),
      highPrice: parseFloat(statsRes.data.highPrice),
      lowPrice: parseFloat(statsRes.data.lowPrice),
      volume: parseFloat(statsRes.data.volume),
      quoteVolume: parseFloat(statsRes.data.quoteVolume)
    };
  } catch (error) {
    throw new Error(`❌ Invalid symbol: ${symbol}`);
  }
}

async function getTrendingCoins() {
  try {
    const response = await axios.get(`${BINANCE_API}/fapi/v1/ticker/24hr`);
    return response.data
      .filter(coin => coin.symbol.endsWith('USDT'))
      .map(coin => ({
        symbol: coin.symbol,
        priceChangePercent: parseFloat(coin.priceChangePercent),
        volume: parseFloat(coin.quoteVolume)
      }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 15);
  } catch (error) {
    throw new Error('Failed to fetch trending coins');
  }
}

// ═══════════════════════════════════════════════════════════
// 💰 TRADING CALCULATIONS
// ═══════════════════════════════════════════════════════════

function calculateLiquidationPrice(entryPrice, leverage, type) {
  const maintenanceMarginRate = 0.004;
  
  if (type === 'LONG') {
    return entryPrice * (1 - (1 / leverage) + maintenanceMarginRate);
  } else {
    return entryPrice * (1 + (1 / leverage) - maintenanceMarginRate);
  }
}

function calculatePnL(position, currentPrice) {
  const priceDiff = currentPrice - position.entryPrice;
  const multiplier = position.type === 'LONG' ? 1 : -1;
  const pnl = (priceDiff * multiplier * position.amount * position.leverage);
  const roi = (pnl / position.margin) * 100;
  
  return { pnl, roi };
}

function calculateCommission(positionSize) {
  return positionSize * COMMISSION_RATE;
}

// ═══════════════════════════════════════════════════════════
// 🎨 UI COMPONENTS
// ═══════════════════════════════════════════════════════════

function getMainMenu() {
  return {
    inline_keyboard: [
      [
        { text: '💼 Portfolio', callback_data: 'portfolio' },
        { text: '📊 Positions', callback_data: 'positions' }
      ],
      [
        { text: '🎯 New Trade', callback_data: 'new_trade' },
        { text: '🪙 Markets', callback_data: 'markets' }
      ],
      [
        { text: '📈 Analysis', callback_data: 'analysis' },
        { text: '📜 History', callback_data: 'history' }
      ],
      [
        { text: '⚙️ Settings', callback_data: 'settings' },
        { text: '📚 Tutorial', callback_data: 'tutorial' }
      ]
    ]
  };
}

function getBackToMenu() {
  return {
    inline_keyboard: [
      [{ text: '🏠 Main Menu', callback_data: 'menu' }]
    ]
  };
}

function getNavigationButtons(backTo = 'menu') {
  return {
    inline_keyboard: [
      [
        { text: '🏠 Home', callback_data: 'menu' },
        { text: '🔙 Back', callback_data: backTo }
      ]
    ]
  };
}

// ═══════════════════════════════════════════════════════════
// 🚀 COMMAND HANDLERS
// ═══════════════════════════════════════════════════════════

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name || 'Trader';
  initUser(chatId);
  
  const welcomeMsg = `
╔═══════════════════════════╗
    🎯 FUTURES TRADING BOT V2
╚═══════════════════════════╝

Welcome, *${firstName}*! 👋

Your demo account has been created with:
💰 *$${formatNumber(INITIAL_BALANCE)}* starting balance

━━━━━━━━━━━━━━━━━━━━━━━━━

✨ *NEW FEATURES IN V2:*

🎯 Take Profit & Stop Loss orders
📊 Advanced portfolio analytics
🔔 Real-time notifications
📈 Market trends & insights
🎓 Interactive tutorial
⚡ Faster trade execution

━━━━━━━━━━━━━━━━━━━━━━━━

🎓 *FIRST TIME HERE?*
Click "📚 Tutorial" to learn the basics!

🚀 *READY TO TRADE?*
Click "🎯 New Trade" to get started!

━━━━━━━━━━━━━━━━━━━━━━━━━

💡 *Quick Commands:*
/trade <COIN> - Quick trade
/price <COIN> - Check price
/menu - Show this menu
  `.trim();

  bot.sendMessage(chatId, welcomeMsg, {
    parse_mode: 'Markdown',
    reply_markup: getMainMenu()
  });
});

bot.onText(/\/menu/, (msg) => {
  const chatId = msg.chat.id;
  showMainMenu(chatId);
});

bot.onText(/\/trade (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const coin = match[1].trim().toUpperCase();
  await startNewTrade(chatId, coin);
});

bot.onText(/\/price (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const coin = match[1].trim().toUpperCase();
  
  try {
    const loadingMsg = await bot.sendMessage(chatId, '⏳ Fetching price...');
    const data = await getCoinDetails(coin);
    
    const emoji = data.priceChangePercent >= 0 ? '🟢' : '🔴';
    const sign = data.priceChangePercent >= 0 ? '+' : '';
    
    const message = `
╔═══════════════════════════╗
    ${emoji} *${data.symbol}*
╚═══════════════════════════╝

💰 *Current Price*
   $${formatNumber(data.price, 4)}

━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *24h Performance*
   ${emoji} ${sign}${formatNumber(data.priceChangePercent)}%

📈 *24h High:* $${formatNumber(data.highPrice, 4)}
📉 *24h Low:* $${formatNumber(data.lowPrice, 4)}

━━━━━━━━━━━━━━━━━━━━━━━━━

💵 *24h Volume*
   $${formatVolume(data.quoteVolume)}
    `.trim();

    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: loadingMsg.message_id,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🎯 Trade This Coin', callback_data: `trade_${data.symbol}` }],
          [{ text: '🏠 Main Menu', callback_data: 'menu' }]
        ]
      }
    });
  } catch (error) {
    bot.sendMessage(chatId, error.message, { reply_markup: getBackToMenu() });
  }
});

// ═══════════════════════════════════════════════════════════
// 🎯 MAIN MENU & NAVIGATION
// ═══════════════════════════════════════════════════════════

function showMainMenu(chatId, messageId = null) {
  const user = initUser(chatId);
  
  let unrealizedPnL = 0;
  user.positions.forEach(pos => {
    // Simplified PnL calculation for menu
    unrealizedPnL += (pos.currentPnL || 0);
  });
  
  const totalEquity = user.balance + unrealizedPnL;
  const equityEmoji = totalEquity >= INITIAL_BALANCE ? '🟢' : '🔴';
  
  const message = `
╔═══════════════════════════╗
    💼 TRADING DASHBOARD
╚═══════════════════════════╝

${equityEmoji} *Total Equity:* $${formatNumber(totalEquity)}
💵 *Available:* $${formatNumber(user.balance)}
📊 *Open Positions:* ${user.positions.length}

━━━━━━━━━━━━━━━━━━━━━━━━━

Select an option below:
  `.trim();

  if (messageId) {
    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: getMainMenu()
    }).catch(() => {});
  } else {
    bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: getMainMenu()
    });
  }
}

// ═══════════════════════════════════════════════════════════
// 💼 PORTFOLIO VIEW
// ═══════════════════════════════════════════════════════════

async function showPortfolio(chatId, messageId = null) {
  const user = initUser(chatId);
  
  let unrealizedPnL = 0;
  
  // Update current PnL for all positions
  for (const position of user.positions) {
    try {
      const data = await getCoinPrice(position.symbol);
      const { pnl } = calculatePnL(position, data.price);
      position.currentPnL = pnl;
      unrealizedPnL += pnl;
    } catch (error) {
      console.error('Error updating position:', error.message);
    }
  }
  
  const totalEquity = user.balance + unrealizedPnL;
  const netPnL = user.stats.totalProfit + user.stats.totalLoss;
  const totalROI = ((netPnL / INITIAL_BALANCE) * 100).toFixed(2);
  const winRate = user.stats.totalTrades > 0 
    ? ((user.stats.winningTrades / user.stats.totalTrades) * 100).toFixed(1)
    : 0;
  
  const equityEmoji = totalEquity >= INITIAL_BALANCE ? '🟢' : '🔴';
  const roiEmoji = netPnL >= 0 ? '🟢' : '🔴';
  const unrealizedEmoji = unrealizedPnL >= 0 ? '🟢' : '🔴';
  
  const message = `
╔═══════════════════════════╗
    💼 PORTFOLIO OVERVIEW
╚═══════════════════════════╝

🕐 *${new Date().toLocaleTimeString()}*

━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *ACCOUNT BALANCE*

${equityEmoji} Total Equity: *$${formatNumber(totalEquity)}*
💵 Available Balance: $${formatNumber(user.balance)}
🔒 In Positions: $${formatNumber(user.positions.reduce((sum, p) => sum + p.margin, 0))}

━━━━━━━━━━━━━━━━━━━━━━━━

📈 *PERFORMANCE*

${roiEmoji} Total ROI: *${totalROI >= 0 ? '+' : ''}${totalROI}%*
${unrealizedEmoji} Unrealized P&L: ${unrealizedPnL >= 0 ? '+' : ''}$${formatNumber(unrealizedPnL)}
🟢 Realized Profit: +$${formatNumber(user.stats.totalProfit)}
🔴 Realized Loss: $${formatNumber(user.stats.totalLoss)}

━━━━━━━━━━━━━━━━━━━━━━━━

📊 *TRADING STATS*

🎯 Win Rate: ${winRate}%
📈 Total Trades: ${user.stats.totalTrades}
✅ Winning: ${user.stats.winningTrades}
❌ Losing: ${user.stats.losingTrades}

━━━━━━━━━━━━━━━━━━━━━━━━

🏆 Best Trade: +$${formatNumber(user.stats.bestTrade)}
💔 Worst Trade: $${formatNumber(user.stats.worstTrade)}
💸 Total Commission: $${formatNumber(user.stats.totalCommission)}

━━━━━━━━━━━━━━━━━━━━━━━━━
  `.trim();

  const keyboard = {
    inline_keyboard: [
      [
        { text: '🔄 Refresh', callback_data: 'portfolio' },
        { text: '📊 Positions', callback_data: 'positions' }
      ],
      [
        { text: '🏠 Main Menu', callback_data: 'menu' }
      ]
    ]
  };

  if (messageId) {
    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    }).catch(() => {});
  } else {
    bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }
}

// ═══════════════════════════════════════════════════════════
// 📊 POSITIONS VIEW
// ═══════════════════════════════════════════════════════════

async function showPositions(chatId, messageId = null) {
  const user = initUser(chatId);
  
  if (user.positions.length === 0) {
    const message = `
╔═══════════════════════════╗
    📊 OPEN POSITIONS
╚═══════════════════════════╝

You have no open positions.

━━━━━━━━━━━━━━━━━━━━━━━━━

💡 Ready to start trading?
Click "🎯 New Trade" to open your first position!

━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = {
      inline_keyboard: [
        [{ text: '🎯 New Trade', callback_data: 'new_trade' }],
        [{ text: '🏠 Main Menu', callback_data: 'menu' }]
      ]
    };

    if (messageId) {
      bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      }).catch(() => {});
    } else {
      bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    }
    return;
  }

  let message = `
╔═══════════════════════════╗
    📊 OPEN POSITIONS (${user.positions.length})
╚═══════════════════════════╝

🕐 *${new Date().toLocaleTimeString()}*

━━━━━━━━━━━━━━━━━━━━━━━━━

`;

  let totalPnL = 0;
  const buttons = [];

  for (const position of user.positions) {
    try {
      const data = await getCoinPrice(position.symbol);
      const { pnl, roi } = calculatePnL(position, data.price);
      position.currentPnL = pnl;
      totalPnL += pnl;

      const pnlEmoji = pnl >= 0 ? '🟢' : '🔴';
      const typeEmoji = position.type === 'LONG' ? '🟢 📈' : '🔴 📉';
      const sign = pnl >= 0 ? '+' : '';
      
      const distanceToLiq = position.type === 'LONG'
        ? ((data.price - position.liquidationPrice) / data.price * 100)
        : ((position.liquidationPrice - data.price) / data.price * 100);
      
      const liqWarning = distanceToLiq < 10 ? '⚠️ ' : '';

      message += `${typeEmoji} *${position.symbol}* ⚡${position.leverage}x\n\n`;
      message += `💰 Entry: $${formatNumber(position.entryPrice, 4)}\n`;
      message += `📊 Current: $${formatNumber(data.price, 4)}\n`;
      message += `${pnlEmoji} P&L: ${sign}$${formatNumber(pnl)} (${sign}${formatNumber(roi)}%)\n\n`;
      
      if (position.takeProfit) {
        message += `🎯 TP: $${formatNumber(position.takeProfit, 4)}\n`;
      }
      if (position.stopLoss) {
        message += `🛑 SL: $${formatNumber(position.stopLoss, 4)}\n`;
      }
      
      message += `${liqWarning}⚠️ Liq: $${formatNumber(position.liquidationPrice, 4)}\n`;
      message += `💵 Margin: $${formatNumber(position.margin)}\n\n`;
      message += `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

      buttons.push([
        { 
          text: `${pnl >= 0 ? '🟢' : '🔴'} ${position.symbol} ${position.type}`, 
          callback_data: `view_position_${position.id}` 
        }
      ]);
    } catch (error) {
      console.error('Error fetching position data:', error.message);
    }
  }

  const totalEmoji = totalPnL >= 0 ? '🟢' : '🔴';
  message += `${totalEmoji} *TOTAL P&L: ${totalPnL >= 0 ? '+' : ''}$${formatNumber(totalPnL)}*\n\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━━━━━`;

  buttons.push([
    { text: '🔄 Refresh', callback_data: 'positions' },
    { text: '❌ Close All', callback_data: 'close_all_confirm' }
  ]);
  buttons.push([
    { text: '🏠 Main Menu', callback_data: 'menu' }
  ]);

  if (messageId) {
    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    }).catch(() => {});
  } else {
    bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  }
}

// ═══════════════════════════════════════════════════════════
// 👁️ VIEW SINGLE POSITION
// ═══════════════════════════════════════════════════════════

async function viewPosition(chatId, positionId, messageId) {
  const user = initUser(chatId);
  const position = user.positions.find(p => p.id === positionId);
  
  if (!position) {
    bot.answerCallbackQuery(query.id, { text: '❌ Position not found!', show_alert: true });
    return;
  }

  try {
    const data = await getCoinPrice(position.symbol);
    const { pnl, roi } = calculatePnL(position, data.price);
    
    const pnlEmoji = pnl >= 0 ? '🟢' : '🔴';
    const typeEmoji = position.type === 'LONG' ? '🟢 📈' : '🔴 📉';
    const sign = pnl >= 0 ? '+' : '';
    
    const duration = Math.floor((Date.now() - position.openTime) / 1000 / 60);
    const timeStr = duration < 60 ? `${duration}m` : `${Math.floor(duration / 60)}h ${duration % 60}m`;
    
    const priceChange = ((data.price - position.entryPrice) / position.entryPrice * 100);
    
    const message = `
╔═══════════════════════════╗
    ${typeEmoji} POSITION DETAILS
╚═══════════════════════════╝

📊 *${position.symbol}* ⚡${position.leverage}x

━━━━━━━━━━━━━━━━━━━━━━━━━

💰 *PRICES*

Entry Price: $${formatNumber(position.entryPrice, 4)}
Current Price: $${formatNumber(data.price, 4)}
Price Change: ${priceChange >= 0 ? '+' : ''}${formatNumber(priceChange)}%

━━━━━━━━━━━━━━━━━━━━━━━━━

${pnlEmoji} *PROFIT & LOSS*

P&L: *${sign}$${formatNumber(pnl)}*
ROI: *${sign}${formatNumber(roi)}%*

━━━━━━━━━━━━━━━━━━━━━━━━━

📋 *POSITION INFO*

Type: ${position.type}
Leverage: ${position.leverage}x
Margin: $${formatNumber(position.margin)}
Position Size: $${formatNumber(position.margin * position.leverage)}
Duration: ${timeStr}

━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 *ORDERS*

${position.takeProfit ? `✅ Take Profit: $${formatNumber(position.takeProfit, 4)}` : '❌ No TP set'}
${position.stopLoss ? `✅ Stop Loss: $${formatNumber(position.stopLoss, 4)}` : '❌ No SL set'}

━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ *RISK*

Liquidation: $${formatNumber(position.liquidationPrice, 4)}

━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = {
      inline_keyboard: [
        [
          { text: '🎯 Set TP/SL', callback_data: `set_tpsl_${position.id}` }
        ],
        [
          { text: '❌ Close Position', callback_data: `close_position_${position.id}` }
        ],
        [
          { text: '🔙 Back', callback_data: 'positions' },
          { text: '🏠 Home', callback_data: 'menu' }
        ]
      ]
    };

    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    }).catch(() => {});
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`, { reply_markup: getBackToMenu() });
  }
}

// ═══════════════════════════════════════════════════════════
// 🎯 NEW TRADE FLOW
// ═══════════════════════════════════════════════════════════

async function startNewTrade(chatId, symbol = null, messageId = null) {
  if (!symbol) {
    const message = `
╔═══════════════════════════╗
    🎯 START NEW TRADE
╚═══════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━

📝 *How to start:*

1️⃣ Type the coin symbol
   Example: BTC, ETH, SOL

2️⃣ Or use quick command:
   \`/trade BTC\`

━━━━━━━━━━━━━━━━━━━━━━━━━

💡 *Need help finding coins?*
Check the "🪙 Markets" section!

━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = {
      inline_keyboard: [
        [{ text: '🪙 Browse Markets', callback_data: 'markets' }],
        [{ text: '🏠 Main Menu', callback_data: 'menu' }]
      ]
    };

    if (messageId) {
      bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      }).catch(() => {});
    } else {
      bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    }
    return;
  }

  try {
    const loadingMsg = messageId 
      ? await bot.editMessageText('⏳ Loading...', { chat_id: chatId, message_id: messageId })
      : await bot.sendMessage(chatId, '⏳ Loading...');
    
    const msgId = messageId || loadingMsg.message_id;
    const data = await getCoinDetails(symbol);
    
    const emoji = data.priceChangePercent >= 0 ? '🟢' : '🔴';
    const sign = data.priceChangePercent >= 0 ? '+' : '';
    
    const message = `
╔═══════════════════════════╗
    ${emoji} ${data.symbol}
╚═══════════════════════════╝

💰 *Current Price*
   ${formatNumber(data.price, 4)}

━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *24h Performance*
   ${emoji} ${sign}${formatNumber(data.priceChangePercent)}%

📈 High: ${formatNumber(data.highPrice, 4)}
📉 Low: ${formatNumber(data.lowPrice, 4)}

━━━━━━━━━━━━━━━━━━━━━━━━━

💡 *Select Position Type:*

🟢 LONG - Profit when price goes UP
🔴 SHORT - Profit when price goes DOWN

━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: msgId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🟢 LONG', callback_data: `long_${data.symbol}` },
            { text: '🔴 SHORT', callback_data: `short_${data.symbol}` }
          ],
          [
            { text: '🏠 Home', callback_data: 'menu' }
          ]
        ]
      }
    }).catch(() => {});
  } catch (error) {
    bot.sendMessage(chatId, error.message, { reply_markup: getBackToMenu() });
  }
}

// ═══════════════════════════════════════════════════════════
// 💵 AMOUNT SELECTION
// ═══════════════════════════════════════════════════════════

function showAmountSelection(chatId, messageId, symbol, type) {
  const user = initUser(chatId);
  const emoji = type === 'long' ? '🟢 📈' : '🔴 📉';
  
  const quickAmounts = [50, 100, 250, 500, 1000, 2500];
  const buttons = [];
  
  quickAmounts.forEach(amt => {
    if (amt <= user.balance) {
      buttons.push([{ text: `${amt}`, callback_data: `amount_${amt}` }]);
    }
  });
  
  buttons.push([
    { text: `💰 Max (${formatNumber(user.balance)})`, callback_data: 'amount_max' }
  ]);
  buttons.push([
    { text: '✏️ Custom Amount', callback_data: 'amount_custom' }
  ]);
  buttons.push([
    { text: '🔙 Back', callback_data: `trade_${symbol}` }
  ]);

  const message = `
╔═══════════════════════════╗
    ${emoji} ${type.toUpperCase()} ${symbol}
╚═══════════════════════════╝

💼 *Available Balance*
   ${formatNumber(user.balance)}

━━━━━━━━━━━━━━━━━━━━━━━━━

💡 *Select Margin Amount:*

This is how much you want to risk on this trade.

━━━━━━━━━━━━━━━━━━━━━━━━━
  `.trim();

  bot.editMessageText(message, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  }).catch(() => {});
}

// ═══════════════════════════════════════════════════════════
// ⚡ LEVERAGE SELECTION
// ═══════════════════════════════════════════════════════════

function showLeverageSelection(chatId, messageId, state) {
  const emoji = state.action === 'long' ? '🟢 📈' : '🔴 📉';
  
  const leverages = [2, 5, 10, 20, 25, 50, 75, 100];
  const buttons = [];
  
  for (let i = 0; i < leverages.length; i += 2) {
    buttons.push([
      { text: `⚡${leverages[i]}x`, callback_data: `leverage_${leverages[i]}` },
      { text: `⚡${leverages[i + 1]}x`, callback_data: `leverage_${leverages[i + 1]}` }
    ]);
  }
  
  buttons.push([
    { text: '✏️ Custom Leverage', callback_data: 'leverage_custom' }
  ]);
  buttons.push([
    { text: '🔙 Back', callback_data: `${state.action}_${state.symbol}` }
  ]);

  const message = `
╔═══════════════════════════╗
    ${emoji} ${state.action.toUpperCase()} ${state.symbol}
╚═══════════════════════════╝

💵 *Margin Amount*
   ${formatNumber(state.amount)}

━━━━━━━━━━━━━━━━━━━━━━━━━

⚡ *Select Leverage:*

Higher leverage = Higher risk & reward
Lower leverage = Safer trading

━━━━━━━━━━━━━━━━━━━━━━━━━

💡 *Position Size Examples:*

2x → ${formatNumber(state.amount * 2)}
10x → ${formatNumber(state.amount * 10)}
50x → ${formatNumber(state.amount * 50)}

━━━━━━━━━━━━━━━━━━━━━━━━━
  `.trim();

  bot.editMessageText(message, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  }).catch(() => {});
}

// ═══════════════════════════════════════════════════════════
// ✅ TRADE CONFIRMATION
// ═══════════════════════════════════════════════════════════

async function showTradeConfirmation(chatId, messageId, state) {
  try {
    const data = await getCoinDetails(state.symbol);
    const positionSize = state.amount * state.leverage;
    const commission = calculateCommission(positionSize);
    const liquidationPrice = calculateLiquidationPrice(data.price, state.leverage, state.action.toUpperCase());
    
    const emoji = state.action === 'long' ? '🟢 📈' : '🔴 📉';
    
    const message = `
╔═══════════════════════════╗
    ${emoji} CONFIRM TRADE
╚═══════════════════════════╝

📊 *${state.symbol}*
${state.action.toUpperCase()} Position

━━━━━━━━━━━━━━━━━━━━━━━━━

💰 *PRICES*

Entry Price: ${formatNumber(data.price, 4)}
Liquidation: ${formatNumber(liquidationPrice, 4)}

━━━━━━━━━━━━━━━━━━━━━━━━━

💵 *POSITION DETAILS*

Margin: ${formatNumber(state.amount)}
Leverage: ${state.leverage}x
Position Size: ${formatNumber(positionSize)}
Commission: ${formatNumber(commission)}

━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *POTENTIAL P&L (1% move)*

🟢 Profit: +${formatNumber(positionSize * 0.01)}
🔴 Loss: -${formatNumber(positionSize * 0.01)}

━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ *RISK WARNING*

Max Loss: -${formatNumber(state.amount)} (margin)

━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Ready to open this position?
    `.trim();

    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ CONFIRM TRADE', callback_data: 'confirm_trade' }
          ],
          [
            { text: '❌ Cancel', callback_data: 'menu' }
          ]
        ]
      }
    }).catch(() => {});
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`, { reply_markup: getBackToMenu() });
  }
}

// ═══════════════════════════════════════════════════════════
// 🎯 SET TAKE PROFIT / STOP LOSS
// ═══════════════════════════════════════════════════════════

async function showTPSLSetup(chatId, messageId, positionId) {
  const user = initUser(chatId);
  const position = user.positions.find(p => p.id === positionId);
  
  if (!position) {
    bot.answerCallbackQuery(query.id, { text: '❌ Position not found!', show_alert: true });
    return;
  }

  try {
    const data = await getCoinPrice(position.symbol);
    const typeEmoji = position.type === 'LONG' ? '🟢 📈' : '🔴 📉';
    
    const suggestedTP = position.type === 'LONG'
      ? position.entryPrice * 1.1 // 10% above
      : position.entryPrice * 0.9; // 10% below
    
    const suggestedSL = position.type === 'LONG'
      ? position.entryPrice * 0.95 // 5% below
      : position.entryPrice * 1.05; // 5% above
    
    const message = `
╔═══════════════════════════╗
    ${typeEmoji} SET TP/SL
╚═══════════════════════════╝

📊 *${position.symbol}* ${position.type}

━━━━━━━━━━━━━━━━━━━━━━━━━

💰 *CURRENT PRICES*

Entry: ${formatNumber(position.entryPrice, 4)}
Current: ${formatNumber(data.price, 4)}

━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 *SUGGESTED LEVELS*

Take Profit: ${formatNumber(suggestedTP, 4)} (+10%)
Stop Loss: ${formatNumber(suggestedSL, 4)} (-5%)

━━━━━━━━━━━━━━━━━━━━━━━━━

💡 *What would you like to set?*

🎯 TP = Close position at profit
🛑 SL = Close position to limit loss

━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = {
      inline_keyboard: [
        [
          { text: '🎯 Set Take Profit', callback_data: `tp_input_${positionId}` },
        ],
        [
          { text: '🛑 Set Stop Loss', callback_data: `sl_input_${positionId}` }
        ],
        [
          { text: '⚡ Quick TP/SL (10%/5%)', callback_data: `quick_tpsl_${positionId}` }
        ],
        [
          { text: '🔙 Back', callback_data: `view_position_${positionId}` }
        ]
      ]
    };

    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    }).catch(() => {});
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`, { reply_markup: getBackToMenu() });
  }
}

// ═══════════════════════════════════════════════════════════
// 💼 EXECUTE TRADE
// ═══════════════════════════════════════════════════════════

async function executeTrade(chatId, state, messageId) {
  try {
    const user = initUser(chatId);
    const data = await getCoinDetails(state.symbol);
    
    if (state.amount > user.balance) {
      const errorMsg = `
╔═══════════════════════════╗
    ❌ INSUFFICIENT BALANCE
╚═══════════════════════════╝

Required: ${formatNumber(state.amount)}
Available: ${formatNumber(user.balance)}

━━━━━━━━━━━━━━━━━━━━━━━━━

Please select a lower amount.
      `.trim();
      
      bot.editMessageText(errorMsg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: getBackToMenu()
      }).catch(() => {});
      return;
    }

    const positionSize = state.amount * state.leverage;
    const commission = calculateCommission(positionSize);
    const liquidationPrice = calculateLiquidationPrice(data.price, state.leverage, state.action.toUpperCase());

    const position = {
      id: Date.now(),
      symbol: data.symbol,
      type: state.action.toUpperCase(),
      entryPrice: data.price,
      amount: positionSize / data.price,
      margin: state.amount,
      leverage: state.leverage,
      liquidationPrice: liquidationPrice,
      takeProfit: null,
      stopLoss: null,
      openTime: Date.now(),
      commission: commission,
      currentPnL: 0
    };

    user.positions.push(position);
    user.balance -= state.amount;
    user.stats.totalCommission += commission;

    const emoji = state.action === 'long' ? '🟢' : '🔴';
    const typeEmoji = state.action === 'long' ? '🟢 📈' : '🔴 📉';
    
    const message = `
╔═══════════════════════════╗
    ${emoji} POSITION OPENED
╚═══════════════════════════╝

${typeEmoji} *${position.symbol}* ${position.type}

━━━━━━━━━━━━━━━━━━━━━━━━━

✅ *Position successfully opened!*

━━━━━━━━━━━━━━━━━━━━━━━━━

💰 *ENTRY DETAILS*

Entry Price: ${formatNumber(position.entryPrice, 4)}
Position Size: ${formatNumber(positionSize)}
Leverage: ${state.leverage}x
Margin Used: ${formatNumber(state.amount)}

━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ *RISK MANAGEMENT*

Liquidation: ${formatNumber(liquidationPrice, 4)}

💡 Set TP/SL to manage risk!

━━━━━━━━━━━━━━━━━━━━━━━━━

💼 *ACCOUNT*

New Balance: ${formatNumber(user.balance)}
Commission Paid: ${formatNumber(commission)}

━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🎯 Set TP/SL', callback_data: `set_tpsl_${position.id}` }
          ],
          [
            { text: '📊 View Position', callback_data: `view_position_${position.id}` }
          ],
          [
            { text: '🏠 Main Menu', callback_data: 'menu' }
          ]
        ]
      }
    }).catch(() => {});
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`, { reply_markup: getBackToMenu() });
  }
}

// ═══════════════════════════════════════════════════════════
// ❌ CLOSE POSITION
// ═══════════════════════════════════════════════════════════

async function closePosition(chatId, positionId, messageId) {
  const user = initUser(chatId);
  const position = user.positions.find(p => p.id === positionId);
  
  if (!position) {
    bot.answerCallbackQuery(query.id, { text: '❌ Position not found!', show_alert: true });
    return;
  }

  try {
    const data = await getCoinPrice(position.symbol);
    const { pnl, roi } = calculatePnL(position, data.price);
    const closeCommission = calculateCommission(position.margin * position.leverage);
    const netPnL = pnl - closeCommission;

    user.balance += position.margin + netPnL;
    user.stats.totalCommission += closeCommission;
    user.stats.totalTrades++;

    if (netPnL >= 0) {
      user.stats.winningTrades++;
      user.stats.totalProfit += netPnL;
      if (netPnL > user.stats.bestTrade) {
        user.stats.bestTrade = netPnL;
      }
    } else {
      user.stats.losingTrades++;
      user.stats.totalLoss += netPnL;
      if (netPnL < user.stats.worstTrade) {
        user.stats.worstTrade = netPnL;
      }
    }

    const trade = {
      ...position,
      exitPrice: data.price,
      closeTime: Date.now(),
      pnl: netPnL,
      roi: roi,
      status: 'CLOSED'
    };

    user.tradeHistory.push(trade);
    const index = user.positions.indexOf(position);
    user.positions.splice(index, 1);

    const resultEmoji = netPnL >= 0 ? '🟢' : '🔴';
    const typeEmoji = trade.type === 'LONG' ? '🟢 📈' : '🔴 📉';
    const sign = netPnL >= 0 ? '+' : '';
    const duration = Math.floor((trade.closeTime - trade.openTime) / 1000 / 60);
    const timeStr = duration < 60 ? `${duration}m` : `${Math.floor(duration / 60)}h ${duration % 60}m`;
    
    const message = `
╔═══════════════════════════╗
    ${resultEmoji} POSITION CLOSED
╚═══════════════════════════╝

${typeEmoji} *${trade.symbol}* ${trade.type}

━━━━━━━━━━━━━━━━━━━━━━━━━

${resultEmoji} *RESULT*

Net P&L: *${sign}${formatNumber(netPnL)}*
ROI: *${sign}${formatNumber(roi)}%*

━━━━━━━━━━━━━━━━━━━━━━━━━

💰 *PRICES*

Entry: ${formatNumber(trade.entryPrice, 4)}
Exit: ${formatNumber(trade.exitPrice, 4)}
Change: ${formatNumber(((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100)}%

━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *DETAILS*

Gross P&L: ${sign}${formatNumber(pnl)}
Commissions: -${formatNumber(closeCommission + position.commission)}
Duration: ${timeStr}

━━━━━━━━━━━━━━━━━━━━━━━━━

💼 *ACCOUNT*

New Balance: ${formatNumber(user.balance)}
Win Rate: ${user.stats.totalTrades > 0 ? ((user.stats.winningTrades / user.stats.totalTrades) * 100).toFixed(1) : 0}%

━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🎯 Trade Again', callback_data: `trade_${trade.symbol}` }
          ],
          [
            { text: '📊 View Positions', callback_data: 'positions' }
          ],
          [
            { text: '🏠 Main Menu', callback_data: 'menu' }
          ]
        ]
      }
    }).catch(() => {});
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`, { reply_markup: getBackToMenu() });
  }
}

// ═══════════════════════════════════════════════════════════
// 🪙 MARKETS VIEW
// ═══════════════════════════════════════════════════════════

async function showMarkets(chatId, messageId = null) {
  try {
    const loadingText = '⏳ Loading markets...';
    if (messageId) {
      await bot.editMessageText(loadingText, { chat_id: chatId, message_id: messageId });
    }

    const coins = await getTrendingCoins();
    
    let message = `
╔═══════════════════════════╗
    🪙 TRENDING MARKETS
╚═══════════════════════════╝

Top 15 by Volume

━━━━━━━━━━━━━━━━━━━━━━━━━

`;

    const buttons = [];
    
    coins.forEach((coin, index) => {
      const emoji = coin.priceChangePercent >= 0 ? '🟢' : '🔴';
      const sign = coin.priceChangePercent >= 0 ? '+' : '';
      const coinName = coin.symbol.replace('USDT', '');
      
      message += `${index + 1}. ${emoji} *${coinName}* ${sign}${formatNumber(coin.priceChangePercent)}%\n`;
      
      if ((index + 1) % 3 === 0) {
        message += `\n`;
      }
    });

    message += `\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    message += `💡 Select a coin to trade:`;

    for (let i = 0; i < coins.length; i += 2) {
      const row = [];
      const coin1 = coins[i].symbol.replace('USDT', '');
      row.push({ text: `${coin1}`, callback_data: `trade_${coins[i].symbol}` });
      
      if (coins[i + 1]) {
        const coin2 = coins[i + 1].symbol.replace('USDT', '');
        row.push({ text: `${coin2}`, callback_data: `trade_${coins[i + 1].symbol}` });
      }
      buttons.push(row);
    }

    buttons.push([
      { text: '🔄 Refresh', callback_data: 'markets' }
    ]);
    buttons.push([
      { text: '🏠 Main Menu', callback_data: 'menu' }
    ]);

    if (messageId) {
      bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      }).catch(() => {});
    } else {
      bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      });
    }
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`, { reply_markup: getBackToMenu() });
  }
}

// ═══════════════════════════════════════════════════════════
// 📜 TRADE HISTORY
// ═══════════════════════════════════════════════════════════

function showHistory(chatId, messageId = null) {
  const user = initUser(chatId);
  
  if (user.tradeHistory.length === 0) {
    const message = `
╔═══════════════════════════╗
    📜 TRADE HISTORY
╚═══════════════════════════╝

No completed trades yet.

━━━━━━━━━━━━━━━━━━━━━━━━━

💡 Start trading to build your history!

━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = {
      inline_keyboard: [
        [{ text: '🎯 Start Trading', callback_data: 'new_trade' }],
        [{ text: '🏠 Main Menu', callback_data: 'menu' }]
      ]
    };

    if (messageId) {
      bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      }).catch(() => {});
    } else {
      bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    }
    return;
  }

  const recentTrades = user.tradeHistory.slice(-10).reverse();
  let message = `
╔═══════════════════════════╗
    📜 TRADE HISTORY
╚═══════════════════════════╝

Last ${recentTrades.length} trades

━━━━━━━━━━━━━━━━━━━━━━━━━

`;

  recentTrades.forEach((trade, index) => {
    const emoji = trade.pnl >= 0 ? '🟢' : '🔴';
    const typeEmoji = trade.type === 'LONG' ? '📈' : '📉';
    const sign = trade.pnl >= 0 ? '+' : '';
    
    message += `${emoji} ${typeEmoji} *${trade.symbol}* ⚡${trade.leverage}x\n`;
    message += `   P&L: ${sign}${formatNumber(trade.pnl)} (${sign}${formatNumber(trade.roi)}%)\n`;
    message += `   ${formatTime(trade.closeTime)}\n\n`;
  });

  message += `━━━━━━━━━━━━━━━━━━━━━━━━━`;

  if (messageId) {
    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: getBackToMenu()
    }).catch(() => {});
  } else {
    bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: getBackToMenu()
    });
  }
}

// ═══════════════════════════════════════════════════════════
// 📈 ANALYSIS
// ═══════════════════════════════════════════════════════════

async function showAnalysis(chatId, messageId = null) {
  const user = initUser(chatId);
  
  if (user.stats.totalTrades === 0) {
    const message = `
╔═══════════════════════════╗
    📈 TRADING ANALYSIS
╚═══════════════════════════╝

No trading data available yet.

━━━━━━━━━━━━━━━━━━━━━━━━━

💡 Complete some trades to see your analysis!

━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = {
      inline_keyboard: [
        [{ text: '🎯 Start Trading', callback_data: 'new_trade' }],
        [{ text: '🏠 Main Menu', callback_data: 'menu' }]
      ]
    };

    if (messageId) {
      bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      }).catch(() => {});
    } else {
      bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    }
    return;
  }

  const winRate = ((user.stats.winningTrades / user.stats.totalTrades) * 100).toFixed(1);
  const avgProfit = user.stats.winningTrades > 0 
    ? (user.stats.totalProfit / user.stats.winningTrades).toFixed(2)
    : 0;
  const avgLoss = user.stats.losingTrades > 0
    ? (user.stats.totalLoss / user.stats.losingTrades).toFixed(2)
    : 0;
  const profitFactor = user.stats.totalLoss !== 0
    ? Math.abs(user.stats.totalProfit / user.stats.totalLoss).toFixed(2)
    : 0;
  
  const netPnL = user.stats.totalProfit + user.stats.totalLoss;
  const totalROI = ((netPnL / INITIAL_BALANCE) * 100).toFixed(2);
  
  const roiEmoji = netPnL >= 0 ? '🟢' : '🔴';
  
  let rating = '';
  if (winRate >= 60 && profitFactor >= 2) {
    rating = '🌟🌟🌟🌟🌟 Exceptional!';
  } else if (winRate >= 55 && profitFactor >= 1.5) {
    rating = '⭐⭐⭐⭐ Excellent!';
  } else if (winRate >= 50 && profitFactor >= 1.2) {
    rating = '⭐⭐⭐ Good!';
  } else if (winRate >= 45 && profitFactor >= 1) {
    rating = '⭐⭐ Developing';
  } else {
    rating = '⭐ Keep Learning';
  }

  const message = `
╔═══════════════════════════╗
    📈 TRADING ANALYSIS
╚═══════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *PERFORMANCE OVERVIEW*

${roiEmoji} Total ROI: *${totalROI >= 0 ? '+' : ''}${totalROI}%*
💰 Net P&L: ${netPnL >= 0 ? '+' : ''}${formatNumber(netPnL)}

━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 *TRADING METRICS*

Win Rate: *${winRate}%*
Total Trades: ${user.stats.totalTrades}
✅ Wins: ${user.stats.winningTrades}
❌ Losses: ${user.stats.losingTrades}

━━━━━━━━━━━━━━━━━━━━━━━━━

💵 *PROFIT ANALYSIS*

Profit Factor: *${profitFactor}*
Avg Win: +${avgProfit}
Avg Loss: ${avgLoss}

🟢 Total Profit: +${formatNumber(user.stats.totalProfit)}
🔴 Total Loss: ${formatNumber(user.stats.totalLoss)}

━━━━━━━━━━━━━━━━━━━━━━━━━

🏆 *BEST & WORST*

Best Trade: +${formatNumber(user.stats.bestTrade)}
Worst Trade: ${formatNumber(user.stats.worstTrade)}

━━━━━━━━━━━━━━━━━━━━━━━━━

💸 *COSTS*

Total Commission: ${formatNumber(user.stats.totalCommission)}

━━━━━━━━━━━━━━━━━━━━━━━━━

⭐ *RATING*

${rating}

━━━━━━━━━━━━━━━━━━━━━━━━━
  `.trim();

  const keyboard = {
    inline_keyboard: [
      [
        { text: '💼 Portfolio', callback_data: 'portfolio' },
        { text: '📜 History', callback_data: 'history' }
      ],
      [
        { text: '🏠 Main Menu', callback_data: 'menu' }
      ]
    ]
  };

  if (messageId) {
    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    }).catch(() => {});
  } else {
    bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }
}

// ═══════════════════════════════════════════════════════════
// ⚙️ SETTINGS
// ═══════════════════════════════════════════════════════════

function showSettings(chatId, messageId = null) {
  const user = initUser(chatId);
  
  const message = `
╔═══════════════════════════╗
    ⚙️ SETTINGS
╚═══════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 *AUTO TP/SL*

${user.settings.autoTP ? '✅' : '❌'} Auto Take Profit: ${user.settings.defaultTP}%
${user.settings.autoSL ? '✅' : '❌'} Auto Stop Loss: ${user.settings.defaultSL}%

━━━━━━━━━━━━━━━━━━━━━━━━━

🔔 *NOTIFICATIONS*

${user.settings.notifications ? '✅ Enabled' : '❌ Disabled'}

━━━━━━━━━━━━━━━━━━━━━━━━━

💼 *ACCOUNT*

Balance: ${formatNumber(user.balance)}
Total Equity: ${formatNumber(user.balance)}

━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ *DANGER ZONE*

Reset account to start fresh with ${INITIAL_BALANCE}

━━━━━━━━━━━━━━━━━━━━━━━━━
  `.trim();

  const keyboard = {
    inline_keyboard: [
      [
        { text: user.settings.autoTP ? '✅ Auto TP' : '❌ Auto TP', callback_data: 'toggle_autotp' }
      ],
      [
        { text: user.settings.autoSL ? '✅ Auto SL' : '❌ Auto SL', callback_data: 'toggle_autosl' }
      ],
      [
        { text: user.settings.notifications ? '🔔 Notifications ON' : '🔕 Notifications OFF', callback_data: 'toggle_notifications' }
      ],
      [
        { text: '🔄 Reset Account', callback_data: 'reset_account_confirm' }
      ],
      [
        { text: '🏠 Main Menu', callback_data: 'menu' }
      ]
    ]
  };

  if (messageId) {
    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    }).catch(() => {});
  } else {
    bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }
}

// ═══════════════════════════════════════════════════════════
// 📚 TUTORIAL
// ═══════════════════════════════════════════════════════════

function showTutorial(chatId, messageId = null, page = 1) {
  let message = '';
  let keyboard = null;

  if (page === 1) {
    message = `
╔═══════════════════════════╗
    📚 TUTORIAL (1/4)
╚═══════════════════════════╝

🎯 *WHAT IS FUTURES TRADING?*

━━━━━━━━━━━━━━━━━━━━━━━━━

Futures trading allows you to:

🟢 *GO LONG* - Profit when price rises
🔴 *GO SHORT* - Profit when price falls

━━━━━━━━━━━━━━━━━━━━━━━━

⚡ *LEVERAGE*

Multiply your position size!

Example with $100:
• 2x leverage = $200 position
• 10x leverage = $1,000 position
• 50x leverage = $5,000 position

━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ *IMPORTANT*

Higher leverage = Higher risk!
You can lose your entire margin.

━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    keyboard = {
      inline_keyboard: [
        [{ text: 'Next: Risk Management →', callback_data: 'tutorial_2' }],
        [{ text: '🏠 Main Menu', callback_data: 'menu' }]
      ]
    };
  } else if (page === 2) {
    message = `
╔═══════════════════════════╗
    📚 TUTORIAL (2/4)
╚═══════════════════════════╝

🛡️ *RISK MANAGEMENT*

━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 *TAKE PROFIT (TP)*
Automatically close position at profit target

Example: Entry $100, TP $110
Position closes when price hits $110 ✅

━━━━━━━━━━━━━━━━━━━━━━━━

🛑 *STOP LOSS (SL)*
Limit your losses automatically

Example: Entry $100, SL $95
Position closes if price drops to $95 ❌

━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ *LIQUIDATION*

If price moves too far against you, your position gets liquidated and you lose your margin.

Always set Stop Loss to protect yourself!

━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    keyboard = {
      inline_keyboard: [
        [
          { text: '← Previous', callback_data: 'tutorial_1' },
          { text: 'Next →', callback_data: 'tutorial_3' }
        ],
        [{ text: '🏠 Main Menu', callback_data: 'menu' }]
      ]
    };
  } else if (page === 3) {
    message = `
╔═══════════════════════════╗
    📚 TUTORIAL (3/4)
╚═══════════════════════════╝

📊 *HOW TO TRADE*

━━━━━━━━━━━━━━━━━━━━━━━━━

*STEP 1:* Choose a coin
   Browse markets or use /trade BTC

*STEP 2:* Select direction
   🟢 LONG if you think price will rise
   🔴 SHORT if you think price will fall

*STEP 3:* Set margin amount
   How much you want to risk

*STEP 4:* Choose leverage
   2x-125x multiplier

*STEP 5:* Confirm trade
   Review and confirm your position

━━━━━━━━━━━━━━━━━━━━━━━━━

💡 *PRO TIP*

After opening, immediately set TP/SL for risk management!

━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    keyboard = {
      inline_keyboard: [
        [
          { text: '← Previous', callback_data: 'tutorial_2' },
          { text: 'Next →', callback_data: 'tutorial_4' }
        ],
        [{ text: '🏠 Main Menu', callback_data: 'menu' }]
      ]
    };
  } else if (page === 4) {
    message = `
╔═══════════════════════════╗
    📚 TUTORIAL (4/4)
╚═══════════════════════════╝

💡 *TRADING TIPS*

━━━━━━━━━━━━━━━━━━━━━━━━━

1️⃣ *Start Small*
   Use low leverage (2x-5x) when learning

2️⃣ *Always Use Stop Loss*
   Protect yourself from big losses

3️⃣ *Don't Overtrade*
   Quality over quantity

4️⃣ *Manage Your Risk*
   Never risk more than 5% per trade

5️⃣ *Learn From Mistakes*
   Review your trade history regularly

━━━━━━━━━━━━━━━━━━━━━━━━━

🎓 *READY TO START?*

This is a DEMO account with fake money.
Practice and learn before trading real funds!

━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    keyboard = {
      inline_keyboard: [
        [{ text: '← Previous', callback_data: 'tutorial_3' }],
        [{ text: '🎯 Start Trading Now!', callback_data: 'new_trade' }],
        [{ text: '🏠 Main Menu', callback_data: 'menu' }]
      ]
    };
  }

  if (messageId) {
    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    }).catch(() => {});
  } else {
    bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }
}

// ═══════════════════════════════════════════════════════════
// 🎮 CALLBACK QUERY HANDLER
// ═══════════════════════════════════════════════════════════

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;

  try {
    await bot.answerCallbackQuery(query.id);

    // Navigation
    if (data === 'menu') {
      showMainMenu(chatId, messageId);
      return;
    }

    if (data === 'portfolio') {
      await showPortfolio(chatId, messageId);
      return;
    }

    if (data === 'positions') {
      await showPositions(chatId, messageId);
      return;
    }

    if (data === 'new_trade') {
      await startNewTrade(chatId, null, messageId);
      return;
    }

    if (data === 'markets') {
      await showMarkets(chatId, messageId);
      return;
    }

    if (data === 'history') {
      showHistory(chatId, messageId);
      return;
    }

    if (data === 'analysis') {
      await showAnalysis(chatId, messageId);
      return;
    }

    if (data === 'settings') {
      showSettings(chatId, messageId);
      return;
    }

    if (data.startsWith('tutorial_')) {
      const page = parseInt(data.replace('tutorial_', ''));
      showTutorial(chatId, messageId, page);
      return;
    }

    if (data === 'tutorial') {
      showTutorial(chatId, messageId, 1);
      return;
    }

    // Trade flow
    if (data.startsWith('trade_')) {
      const symbol = data.replace('trade_', '');
      await startNewTrade(chatId, symbol, messageId);
      return;
    }

    if (data.startsWith('long_') || data.startsWith('short_')) {
      const [type, symbol] = data.split('_');
      userStates.set(chatId, { action: type, symbol: symbol, step: 'amount' });
      showAmountSelection(chatId, messageId, symbol, type);
      return;
    }

    if (data.startsWith('amount_')) {
      const state = userStates.get(chatId);
      if (!state) return;

      if (data === 'amount_custom') {
        state.step = 'custom_amount';
        userStates.set(chatId, state);
        bot.editMessageText(
          `💵 *Enter Custom Amount*\n\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\nType the amount in USD you want to use as margin.\n\nExample: 150`,
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: getNavigationButtons(`${state.action}_${state.symbol}`)
          }
        );
        return;
      }

      if (data === 'amount_max') {
        const user = initUser(chatId);
        state.amount = user.balance;
      } else {
        state.amount = parseFloat(data.replace('amount_', ''));
      }

      state.step = 'leverage';
      userStates.set(chatId, state);
      showLeverageSelection(chatId, messageId, state);
      return;
    }

    if (data.startsWith('leverage_')) {
      const state = userStates.get(chatId);
      if (!state) return;

      if (data === 'leverage_custom') {
        state.step = 'custom_leverage';
        userStates.set(chatId, state);
        bot.editMessageText(
          `⚡ *Enter Custom Leverage*\n\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\nType a number between 1 and ${MAX_LEVERAGE}\n\nExample: 15`,
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: getNavigationButtons(`${state.action}_${state.symbol}`)
          }
        );
        return;
      }

      state.leverage = parseInt(data.replace('leverage_', ''));
      userStates.set(chatId, state);
      await showTradeConfirmation(chatId, messageId, state);
      return;
    }

    if (data === 'confirm_trade') {
      const state = userStates.get(chatId);
      if (state) {
        await executeTrade(chatId, state, messageId);
        userStates.delete(chatId);
      }
      return;
    }

    // Position management
    if (data.startsWith('view_position_')) {
      const positionId = parseInt(data.replace('view_position_', ''));
      await viewPosition(chatId, positionId, messageId);
      return;
    }

    if (data.startsWith('close_position_')) {
      const positionId = parseInt(data.replace('close_position_', ''));
      await closePosition(chatId, positionId, messageId);
      return;
    }

    if (data === 'close_all_confirm') {
      const user = initUser(chatId);
      const message = `
╔═══════════════════════════╗
    ⚠️ CLOSE ALL POSITIONS
╚═══════════════════════════╝

Are you sure you want to close all ${user.positions.length} open positions?

━━━━━━━━━━━━━━━━━━━━━━━━━

This action cannot be undone.

━━━━━━━━━━━━━━━━━━━━━━━━━
      `.trim();

      bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Yes, Close All', callback_data: 'close_all_positions' }
            ],
            [
              { text: '❌ Cancel', callback_data: 'positions' }
            ]
          ]
        }
      });
      return;
    }

    if (data === 'close_all_positions') {
      const user = initUser(chatId);
      const positions = [...user.positions];
      
      let totalPnL = 0;
      for (const position of positions) {
        try {
          const priceData = await getCoinPrice(position.symbol);
          const { pnl } = calculatePnL(position, priceData.price);
          const closeCommission = calculateCommission(position.margin * position.leverage);
          const netPnL = pnl - closeCommission;
          
          user.balance += position.margin + netPnL;
          user.stats.totalCommission += closeCommission;
          user.stats.totalTrades++;
          totalPnL += netPnL;

          if (netPnL >= 0) {
            user.stats.winningTrades++;
            user.stats.totalProfit += netPnL;
            if (netPnL > user.stats.bestTrade) user.stats.bestTrade = netPnL;
          } else {
            user.stats.losingTrades++;
            user.stats.totalLoss += netPnL;
            if (netPnL < user.stats.worstTrade) user.stats.worstTrade = netPnL;
          }

          user.tradeHistory.push({
            ...position,
            exitPrice: priceData.price,
            closeTime: Date.now(),
            pnl: netPnL,
            status: 'CLOSED'
          });
        } catch (error) {
    console.error('Message handling error:', error);
    bot.sendMessage(chatId, '❌ An error occurred. Please try again.', {
      reply_markup: getBackToMenu()
    });
    userStates.delete(chatId);
  }
});

// ═══════════════════════════════════════════════════════════
// 🔄 AUTO TP/SL CHECKER (Runs every 10 seconds)
// ═══════════════════════════════════════════════════════════

setInterval(async () => {
  for (const [userId, user] of users.entries()) {
    for (const position of [...user.positions]) {
      try {
        const data = await getCoinPrice(position.symbol);
        const currentPrice = data.price;
        
        let shouldClose = false;
        let closeReason = '';

        // Check Take Profit
        if (position.takeProfit) {
          if (position.type === 'LONG' && currentPrice >= position.takeProfit) {
            shouldClose = true;
            closeReason = 'Take Profit Hit';
          } else if (position.type === 'SHORT' && currentPrice <= position.takeProfit) {
            shouldClose = true;
            closeReason = 'Take Profit Hit';
          }
        }

        // Check Stop Loss
        if (position.stopLoss) {
          if (position.type === 'LONG' && currentPrice <= position.stopLoss) {
            shouldClose = true;
            closeReason = 'Stop Loss Hit';
          } else if (position.type === 'SHORT' && currentPrice >= position.stopLoss) {
            shouldClose = true;
            closeReason = 'Stop Loss Hit';
          }
        }

        // Check Liquidation
        if ((position.type === 'LONG' && currentPrice <= position.liquidationPrice) ||
            (position.type === 'SHORT' && currentPrice >= position.liquidationPrice)) {
          shouldClose = true;
          closeReason = 'LIQUIDATED';
        }

        if (shouldClose) {
          const { pnl, roi } = calculatePnL(position, currentPrice);
          const closeCommission = calculateCommission(position.margin * position.leverage);
          const netPnL = closeReason === 'LIQUIDATED' ? -position.margin : pnl - closeCommission;

          user.balance += position.margin + netPnL;
          user.stats.totalCommission += closeCommission;
          user.stats.totalTrades++;

          if (netPnL >= 0) {
            user.stats.winningTrades++;
            user.stats.totalProfit += netPnL;
            if (netPnL > user.stats.bestTrade) user.stats.bestTrade = netPnL;
          } else {
            user.stats.losingTrades++;
            user.stats.totalLoss += netPnL;
            if (netPnL < user.stats.worstTrade) user.stats.worstTrade = netPnL;
          }

          const trade = {
            ...position,
            exitPrice: currentPrice,
            closeTime: Date.now(),
            pnl: netPnL,
            roi: roi,
            status: closeReason
          };

          user.tradeHistory.push(trade);
          const index = user.positions.indexOf(position);
          user.positions.splice(index, 1);

          // Send notification
          if (user.settings.notifications) {
            const emoji = closeReason === 'LIQUIDATED' ? '💥' : (netPnL >= 0 ? '🟢' : '🔴');
            const typeEmoji = trade.type === 'LONG' ? '📈' : '📉';
            
            const notificationMsg = `
╔═══════════════════════════╗
    ${emoji} ${closeReason.toUpperCase()}
╚═══════════════════════════╝

${typeEmoji} *${trade.symbol}* ${trade.type}

━━━━━━━━━━━━━━━━━━━━━━━━━

${emoji} *Result*
${netPnL >= 0 ? '+' : ''}${formatNumber(netPnL)} (${roi >= 0 ? '+' : ''}${formatNumber(roi)}%)

━━━━━━━━━━━━━━━━━━━━━━━━━

Entry: ${formatNumber(trade.entryPrice, 4)}
Exit: ${formatNumber(trade.exitPrice, 4)}

━━━━━━━━━━━━━━━━━━━━━━━━━

💼 New Balance: ${formatNumber(user.balance)}

━━━━━━━━━━━━━━━━━━━━━━━━━
            `.trim();

            bot.sendMessage(userId, notificationMsg, {
              parse_mode: 'Markdown',
              reply_markup: getMainMenu()
            }).catch(err => console.error('Notification error:', err));
          }
        }
      } catch (error) {
        console.error('Auto TP/SL check error:', error.message);
      }
    }
  }
}, 10000); // Check every 10 seconds

// ═══════════════════════════════════════════════════════════
// 🛡️ ERROR HANDLERS
// ═══════════════════════════════════════════════════════════

bot.on('polling_error', (error) => {
  console.error('Polling error:', error.message);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down bot...');
  bot.stopPolling();
  process.exit(0);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

// ═══════════════════════════════════════════════════════════
// 📝 STARTUP MESSAGE
// ═══════════════════════════════════════════════════════════

console.log(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║        🤖 FUTURES DEMO TRADING BOT V2 🤖             ║
║                                                       ║
║  ✅ Bot Started Successfully                         ║
║  📊 All Systems Operational                          ║
║  🔄 Auto TP/SL Monitor Active                        ║
║                                                       ║
║  Features:                                           ║
║  • Take Profit & Stop Loss                          ║
║  • Real-time Notifications                          ║
║  • Advanced Analytics                               ║
║  • Interactive Tutorial                             ║
║  • Risk Management Tools                            ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
`);

console.log('💡 Configuration:');
console.log(`   • Initial Balance: ${INITIAL_BALANCE}`);
console.log(`   • Max Leverage: ${MAX_LEVERAGE}x`);
console.log(`   • Commission Rate: ${(COMMISSION_RATE * 100).toFixed(2)}%`);
console.log(`   • TP/SL Check Interval: 10 seconds\n`);
console.log('🎯 Bot is ready to receive commands!\n');
console.log('═══════════════════════════════════════════════════════\n'); {
          console.error('Error closing position:', error);
        }
      }

      user.positions = [];

      const emoji = totalPnL >= 0 ? '🟢' : '🔴';
      const message = `
╔═══════════════════════════╗
    ${emoji} ALL POSITIONS CLOSED
╚═══════════════════════════╝

${positions.length} positions closed successfully!

━━━━━━━━━━━━━━━━━━━━━━━━━

${emoji} *Total P&L*
${totalPnL >= 0 ? '+' : ''}${formatNumber(totalPnL)}

━━━━━━━━━━━━━━━━━━━━━━━━━

💼 *New Balance*
${formatNumber(user.balance)}

━━━━━━━━━━━━━━━━━━━━━━━━━
      `.trim();

      bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: getBackToMenu()
      });
      return;
    }

    // TP/SL Management
    if (data.startsWith('set_tpsl_')) {
      const positionId = parseInt(data.replace('set_tpsl_', ''));
      await showTPSLSetup(chatId, messageId, positionId);
      return;
    }

    if (data.startsWith('quick_tpsl_')) {
      const positionId = parseInt(data.replace('quick_tpsl_', ''));
      const user = initUser(chatId);
      const position = user.positions.find(p => p.id === positionId);
      
      if (position) {
        if (position.type === 'LONG') {
          position.takeProfit = position.entryPrice * 1.1; // 10% profit
          position.stopLoss = position.entryPrice * 0.95;  // 5% loss
        } else {
          position.takeProfit = position.entryPrice * 0.9;  // 10% profit
          position.stopLoss = position.entryPrice * 1.05;   // 5% loss
        }

        bot.answerCallbackQuery(query.id, {
          text: '✅ TP/SL set successfully!',
          show_alert: true
        });

        await viewPosition(chatId, positionId, messageId);
      }
      return;
    }

    if (data.startsWith('tp_input_') || data.startsWith('sl_input_')) {
      const positionId = parseInt(data.replace('tp_input_', '').replace('sl_input_', ''));
      const type = data.startsWith('tp_input_') ? 'tp' : 'sl';
      
      userStates.set(chatId, { 
        action: 'set_order', 
        positionId: positionId,
        orderType: type,
        step: 'input_price'
      });

      const label = type === 'tp' ? 'Take Profit' : 'Stop Loss';
      bot.editMessageText(
        `🎯 *Set ${label}*\n\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\nEnter the price at which you want to ${type === 'tp' ? 'take profit' : 'stop loss'}.\n\nExample: 45000`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: getNavigationButtons(`set_tpsl_${positionId}`)
        }
      );
      return;
    }

    // Settings
    if (data === 'toggle_autotp') {
      const user = initUser(chatId);
      user.settings.autoTP = !user.settings.autoTP;
      showSettings(chatId, messageId);
      return;
    }

    if (data === 'toggle_autosl') {
      const user = initUser(chatId);
      user.settings.autoSL = !user.settings.autoSL;
      showSettings(chatId, messageId);
      return;
    }

    if (data === 'toggle_notifications') {
      const user = initUser(chatId);
      user.settings.notifications = !user.settings.notifications;
      showSettings(chatId, messageId);
      return;
    }

    if (data === 'reset_account_confirm') {
      const message = `
╔═══════════════════════════╗
    ⚠️ RESET ACCOUNT
╚═══════════════════════════╝

Are you sure you want to reset your account?

━━━━━━━━━━━━━━━━━━━━━━━━━

This will:
• Close all open positions
• Reset balance to ${INITIAL_BALANCE}
• Clear all trade history
• Reset all statistics

━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ *This action cannot be undone!*

━━━━━━━━━━━━━━━━━━━━━━━━━
      `.trim();

      bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Yes, Reset Account', callback_data: 'reset_account_confirmed' }
            ],
            [
              { text: '❌ Cancel', callback_data: 'settings' }
            ]
          ]
        }
      });
      return;
    }

    if (data === 'reset_account_confirmed') {
      users.delete(chatId);
      initUser(chatId);
      userStates.delete(chatId);

      const message = `
╔═══════════════════════════╗
    ✅ ACCOUNT RESET
╚═══════════════════════════╝

Your account has been reset successfully!

━━━━━━━━━━━━━━━━━━━━━━━━━

💰 New Balance: ${INITIAL_BALANCE}
📊 All positions closed
📜 History cleared
📈 Stats reset

━━━━━━━━━━━━━━━━━━━━━━━━━

Ready to start fresh! 🚀

━━━━━━━━━━━━━━━━━━━━━━━━━
      `.trim();

      bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: getMainMenu()
      });
      return;
    }

  } catch (error) {
    console.error('Callback error:', error);
    bot.answerCallbackQuery(query.id, {
      text: '❌ An error occurred. Please try again.',
      show_alert: true
    });
  }
});

// ═══════════════════════════════════════════════════════════
// 💬 TEXT MESSAGE HANDLER
// ═══════════════════════════════════════════════════════════

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith('/')) return;

  const state = userStates.get(chatId);
  if (!state) return;

  try {
    if (state.step === 'custom_amount') {
      const amount = parseFloat(text);
      const user = initUser(chatId);

      if (isNaN(amount) || amount <= 0) {
        bot.sendMessage(chatId, '❌ Invalid amount. Please enter a valid number:', {
          reply_markup: getNavigationButtons(`${state.action}_${state.symbol}`)
        });
        return;
      }

      if (amount > user.balance) {
        bot.sendMessage(chatId,
          `❌ *Insufficient Balance*\n\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\nRequired: ${formatNumber(amount)}\nAvailable: ${formatNumber(user.balance)}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\nPlease enter a lower amount:`,
          {
            parse_mode: 'Markdown',
            reply_markup: getNavigationButtons(`${state.action}_${state.symbol}`)
          }
        );
        return;
      }

      state.amount = amount;
      state.step = 'leverage';
      userStates.set(chatId, state);

      const sentMsg = await bot.sendMessage(chatId, '⏳ Loading...');
      showLeverageSelection(chatId, sentMsg.message_id, state);

    } else if (state.step === 'custom_leverage') {
      const leverage = parseInt(text);

      if (isNaN(leverage) || leverage < 1 || leverage > MAX_LEVERAGE) {
        bot.sendMessage(chatId,
          `❌ Invalid leverage. Enter a number between 1 and ${MAX_LEVERAGE}:`,
          {
            reply_markup: getNavigationButtons(`${state.action}_${state.symbol}`)
          }
        );
        return;
      }

      state.leverage = leverage;
      userStates.set(chatId, state);

      const sentMsg = await bot.sendMessage(chatId, '⏳ Loading...');
      await showTradeConfirmation(chatId, sentMsg.message_id, state);

    } else if (state.step === 'input_price') {
      const price = parseFloat(text);
      
      if (isNaN(price) || price <= 0) {
        bot.sendMessage(chatId, '❌ Invalid price. Please enter a valid number:', {
          reply_markup: getNavigationButtons(`set_tpsl_${state.positionId}`)
        });
        return;
      }

      const user = initUser(chatId);
      const position = user.positions.find(p => p.id === state.positionId);

      if (position) {
        if (state.orderType === 'tp') {
          position.takeProfit = price;
          bot.sendMessage(chatId, `✅ Take Profit set at ${formatNumber(price, 4)}`, {
            reply_markup: getBackToMenu()
          });
        } else {
          position.stopLoss = price;
          bot.sendMessage(chatId, `✅ Stop Loss set at ${formatNumber(price, 4)}`, {
            reply_markup: getBackToMenu()
          });
        }
        
        userStates.delete(chatId);
      }
    }
  } catch (error) {const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// ═══════════════════════════════════════════════════════════
// 🤖 BOT CONFIGURATION
// ═══════════════════════════════════════════════════════════

const token = 'YOUR_BOT_TOKEN_HERE';
const bot = new TelegramBot(token, { polling: true });

const BINANCE_API = 'https://fapi.binance.com';
const INITIAL_BALANCE = 10000;
const MAX_LEVERAGE = 125;
const COMMISSION_RATE = 0.0004; // 0.04% per trade

console.log('🚀 Futures Demo Trading Bot V2 Started!');

// ═══════════════════════════════════════════════════════════
// 💾 DATA STORAGE
// ═══════════════════════════════════════════════════════════

const users = new Map();
const userStates = new Map();

// ═══════════════════════════════════════════════════════════
// 🔧 UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════

function initUser(userId) {
  if (!users.has(userId)) {
    users.set(userId, {
      balance: INITIAL_BALANCE,
      positions: [],
      orders: [], // Pending TP/SL orders
      tradeHistory: [],
      stats: {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        totalProfit: 0,
        totalLoss: 0,
        bestTrade: 0,
        worstTrade: 0,
        totalCommission: 0
      },
      settings: {
        autoTP: false,
        autoSL: false,
        defaultTP: 10, // 10%
        defaultSL: 5,  // 5%
        notifications: true
      }
    });
  }
  return users.get(userId);
}

const formatNumber = (num, decimals = 2) => {
  return parseFloat(num).toFixed(decimals);
};

const formatVolume = (num) => {
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toFixed(2);
};

const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit' 
  });
};

// ═══════════════════════════════════════════════════════════
// 📊 BINANCE API FUNCTIONS
// ═══════════════════════════════════════════════════════════

async function getCoinPrice(symbol) {
  try {
    symbol = symbol.toUpperCase();
    if (!symbol.endsWith('USDT')) symbol += 'USDT';
    
    const response = await axios.get(`${BINANCE_API}/fapi/v1/ticker/price`, {
      params: { symbol }
    });
    
    return {
      symbol: response.data.symbol,
      price: parseFloat(response.data.price)
    };
  } catch (error) {
    throw new Error(`❌ Invalid symbol: ${symbol}`);
  }
}

async function getCoinDetails(symbol) {
  try {
    symbol = symbol.toUpperCase();
    if (!symbol.endsWith('USDT')) symbol += 'USDT';

    const [priceRes, statsRes] = await Promise.all([
      axios.get(`${BINANCE_API}/fapi/v1/ticker/price`, { params: { symbol } }),
      axios.get(`${BINANCE_API}/fapi/v1/ticker/24hr`, { params: { symbol } })
    ]);

    return {
      symbol: priceRes.data.symbol,
      price: parseFloat(priceRes.data.price),
      priceChange: parseFloat(statsRes.data.priceChange),
      priceChangePercent: parseFloat(statsRes.data.priceChangePercent),
      highPrice: parseFloat(statsRes.data.highPrice),
      lowPrice: parseFloat(statsRes.data.lowPrice),
      volume: parseFloat(statsRes.data.volume),
      quoteVolume: parseFloat(statsRes.data.quoteVolume)
    };
  } catch (error) {
    throw new Error(`❌ Invalid symbol: ${symbol}`);
  }
}

async function getTrendingCoins() {
  try {
    const response = await axios.get(`${BINANCE_API}/fapi/v1/ticker/24hr`);
    return response.data
      .filter(coin => coin.symbol.endsWith('USDT'))
      .map(coin => ({
        symbol: coin.symbol,
        priceChangePercent: parseFloat(coin.priceChangePercent),
        volume: parseFloat(coin.quoteVolume)
      }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 15);
  } catch (error) {
    throw new Error('Failed to fetch trending coins');
  }
}

// ═══════════════════════════════════════════════════════════
// 💰 TRADING CALCULATIONS
// ═══════════════════════════════════════════════════════════

function calculateLiquidationPrice(entryPrice, leverage, type) {
  const maintenanceMarginRate = 0.004;
  
  if (type === 'LONG') {
    return entryPrice * (1 - (1 / leverage) + maintenanceMarginRate);
  } else {
    return entryPrice * (1 + (1 / leverage) - maintenanceMarginRate);
  }
}

function calculatePnL(position, currentPrice) {
  const priceDiff = currentPrice - position.entryPrice;
  const multiplier = position.type === 'LONG' ? 1 : -1;
  const pnl = (priceDiff * multiplier * position.amount * position.leverage);
  const roi = (pnl / position.margin) * 100;
  
  return { pnl, roi };
}

function calculateCommission(positionSize) {
  return positionSize * COMMISSION_RATE;
}

// ═══════════════════════════════════════════════════════════
// 🎨 UI COMPONENTS
// ═══════════════════════════════════════════════════════════

function getMainMenu() {
  return {
    inline_keyboard: [
      [
        { text: '💼 Portfolio', callback_data: 'portfolio' },
        { text: '📊 Positions', callback_data: 'positions' }
      ],
      [
        { text: '🎯 New Trade', callback_data: 'new_trade' },
        { text: '🪙 Markets', callback_data: 'markets' }
      ],
      [
        { text: '📈 Analysis', callback_data: 'analysis' },
        { text: '📜 History', callback_data: 'history' }
      ],
      [
        { text: '⚙️ Settings', callback_data: 'settings' },
        { text: '📚 Tutorial', callback_data: 'tutorial' }
      ]
    ]
  };
}

function getBackToMenu() {
  return {
    inline_keyboard: [
      [{ text: '🏠 Main Menu', callback_data: 'menu' }]
    ]
  };
}

function getNavigationButtons(backTo = 'menu') {
  return {
    inline_keyboard: [
      [
        { text: '🏠 Home', callback_data: 'menu' },
        { text: '🔙 Back', callback_data: backTo }
      ]
    ]
  };
}

// ═══════════════════════════════════════════════════════════
// 🚀 COMMAND HANDLERS
// ═══════════════════════════════════════════════════════════

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name || 'Trader';
  initUser(chatId);
  
  const welcomeMsg = `
╔═══════════════════════════╗
    🎯 FUTURES TRADING BOT V2
╚═══════════════════════════╝

Welcome, *${firstName}*! 👋

Your demo account has been created with:
💰 *$${formatNumber(INITIAL_BALANCE)}* starting balance

━━━━━━━━━━━━━━━━━━━━━━━━━

✨ *NEW FEATURES IN V2:*

🎯 Take Profit & Stop Loss orders
📊 Advanced portfolio analytics
🔔 Real-time notifications
📈 Market trends & insights
🎓 Interactive tutorial
⚡ Faster trade execution

━━━━━━━━━━━━━━━━━━━━━━━━

🎓 *FIRST TIME HERE?*
Click "📚 Tutorial" to learn the basics!

🚀 *READY TO TRADE?*
Click "🎯 New Trade" to get started!

━━━━━━━━━━━━━━━━━━━━━━━━━

💡 *Quick Commands:*
/trade <COIN> - Quick trade
/price <COIN> - Check price
/menu - Show this menu
  `.trim();

  bot.sendMessage(chatId, welcomeMsg, {
    parse_mode: 'Markdown',
    reply_markup: getMainMenu()
  });
});

bot.onText(/\/menu/, (msg) => {
  const chatId = msg.chat.id;
  showMainMenu(chatId);
});

bot.onText(/\/trade (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const coin = match[1].trim().toUpperCase();
  await startNewTrade(chatId, coin);
});

bot.onText(/\/price (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const coin = match[1].trim().toUpperCase();
  
  try {
    const loadingMsg = await bot.sendMessage(chatId, '⏳ Fetching price...');
    const data = await getCoinDetails(coin);
    
    const emoji = data.priceChangePercent >= 0 ? '🟢' : '🔴';
    const sign = data.priceChangePercent >= 0 ? '+' : '';
    
    const message = `
╔═══════════════════════════╗
    ${emoji} *${data.symbol}*
╚═══════════════════════════╝

💰 *Current Price*
   $${formatNumber(data.price, 4)}

━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *24h Performance*
   ${emoji} ${sign}${formatNumber(data.priceChangePercent)}%

📈 *24h High:* $${formatNumber(data.highPrice, 4)}
📉 *24h Low:* $${formatNumber(data.lowPrice, 4)}

━━━━━━━━━━━━━━━━━━━━━━━━━

💵 *24h Volume*
   $${formatVolume(data.quoteVolume)}
    `.trim();

    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: loadingMsg.message_id,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🎯 Trade This Coin', callback_data: `trade_${data.symbol}` }],
          [{ text: '🏠 Main Menu', callback_data: 'menu' }]
        ]
      }
    });
  } catch (error) {
    bot.sendMessage(chatId, error.message, { reply_markup: getBackToMenu() });
  }
});

// ═══════════════════════════════════════════════════════════
// 🎯 MAIN MENU & NAVIGATION
// ═══════════════════════════════════════════════════════════

function showMainMenu(chatId, messageId = null) {
  const user = initUser(chatId);
  
  let unrealizedPnL = 0;
  user.positions.forEach(pos => {
    // Simplified PnL calculation for menu
    unrealizedPnL += (pos.currentPnL || 0);
  });
  
  const totalEquity = user.balance + unrealizedPnL;
  const equityEmoji = totalEquity >= INITIAL_BALANCE ? '🟢' : '🔴';
  
  const message = `
╔═══════════════════════════╗
    💼 TRADING DASHBOARD
╚═══════════════════════════╝

${equityEmoji} *Total Equity:* $${formatNumber(totalEquity)}
💵 *Available:* $${formatNumber(user.balance)}
📊 *Open Positions:* ${user.positions.length}

━━━━━━━━━━━━━━━━━━━━━━━━━

Select an option below:
  `.trim();

  if (messageId) {
    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: getMainMenu()
    }).catch(() => {});
  } else {
    bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: getMainMenu()
    });
  }
}

// ═══════════════════════════════════════════════════════════
// 💼 PORTFOLIO VIEW
// ═══════════════════════════════════════════════════════════

async function showPortfolio(chatId, messageId = null) {
  const user = initUser(chatId);
  
  let unrealizedPnL = 0;
  
  // Update current PnL for all positions
  for (const position of user.positions) {
    try {
      const data = await getCoinPrice(position.symbol);
      const { pnl } = calculatePnL(position, data.price);
      position.currentPnL = pnl;
      unrealizedPnL += pnl;
    } catch (error) {
      console.error('Error updating position:', error.message);
    }
  }
  
  const totalEquity = user.balance + unrealizedPnL;
  const netPnL = user.stats.totalProfit + user.stats.totalLoss;
  const totalROI = ((netPnL / INITIAL_BALANCE) * 100).toFixed(2);
  const winRate = user.stats.totalTrades > 0 
    ? ((user.stats.winningTrades / user.stats.totalTrades) * 100).toFixed(1)
    : 0;
  
  const equityEmoji = totalEquity >= INITIAL_BALANCE ? '🟢' : '🔴';
  const roiEmoji = netPnL >= 0 ? '🟢' : '🔴';
  const unrealizedEmoji = unrealizedPnL >= 0 ? '🟢' : '🔴';
  
  const message = `
╔═══════════════════════════╗
    💼 PORTFOLIO OVERVIEW
╚═══════════════════════════╝

🕐 *${new Date().toLocaleTimeString()}*

━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *ACCOUNT BALANCE*

${equityEmoji} Total Equity: *$${formatNumber(totalEquity)}*
💵 Available Balance: $${formatNumber(user.balance)}
🔒 In Positions: $${formatNumber(user.positions.reduce((sum, p) => sum + p.margin, 0))}

━━━━━━━━━━━━━━━━━━━━━━━━

📈 *PERFORMANCE*

${roiEmoji} Total ROI: *${totalROI >= 0 ? '+' : ''}${totalROI}%*
${unrealizedEmoji} Unrealized P&L: ${unrealizedPnL >= 0 ? '+' : ''}$${formatNumber(unrealizedPnL)}
🟢 Realized Profit: +$${formatNumber(user.stats.totalProfit)}
🔴 Realized Loss: $${formatNumber(user.stats.totalLoss)}

━━━━━━━━━━━━━━━━━━━━━━━━

📊 *TRADING STATS*

🎯 Win Rate: ${winRate}%
📈 Total Trades: ${user.stats.totalTrades}
✅ Winning: ${user.stats.winningTrades}
❌ Losing: ${user.stats.losingTrades}

━━━━━━━━━━━━━━━━━━━━━━━━

🏆 Best Trade: +$${formatNumber(user.stats.bestTrade)}
💔 Worst Trade: $${formatNumber(user.stats.worstTrade)}
💸 Total Commission: $${formatNumber(user.stats.totalCommission)}

━━━━━━━━━━━━━━━━━━━━━━━━━
  `.trim();

  const keyboard = {
    inline_keyboard: [
      [
        { text: '🔄 Refresh', callback_data: 'portfolio' },
        { text: '📊 Positions', callback_data: 'positions' }
      ],
      [
        { text: '🏠 Main Menu', callback_data: 'menu' }
      ]
    ]
  };

  if (messageId) {
    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    }).catch(() => {});
  } else {
    bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }
}

// ═══════════════════════════════════════════════════════════
// 📊 POSITIONS VIEW
// ═══════════════════════════════════════════════════════════

async function showPositions(chatId, messageId = null) {
  const user = initUser(chatId);
  
  if (user.positions.length === 0) {
    const message = `
╔═══════════════════════════╗
    📊 OPEN POSITIONS
╚═══════════════════════════╝

You have no open positions.

━━━━━━━━━━━━━━━━━━━━━━━━━

💡 Ready to start trading?
Click "🎯 New Trade" to open your first position!

━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = {
      inline_keyboard: [
        [{ text: '🎯 New Trade', callback_data: 'new_trade' }],
        [{ text: '🏠 Main Menu', callback_data: 'menu' }]
      ]
    };

    if (messageId) {
      bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      }).catch(() => {});
    } else {
      bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    }
    return;
  }

  let message = `
╔═══════════════════════════╗
    📊 OPEN POSITIONS (${user.positions.length})
╚═══════════════════════════╝

🕐 *${new Date().toLocaleTimeString()}*

━━━━━━━━━━━━━━━━━━━━━━━━━

`;

  let totalPnL = 0;
  const buttons = [];

  for (const position of user.positions) {
    try {
      const data = await getCoinPrice(position.symbol);
      const { pnl, roi } = calculatePnL(position, data.price);
      position.currentPnL = pnl;
      totalPnL += pnl;

      const pnlEmoji = pnl >= 0 ? '🟢' : '🔴';
      const typeEmoji = position.type === 'LONG' ? '🟢 📈' : '🔴 📉';
      const sign = pnl >= 0 ? '+' : '';
      
      const distanceToLiq = position.type === 'LONG'
        ? ((data.price - position.liquidationPrice) / data.price * 100)
        : ((position.liquidationPrice - data.price) / data.price * 100);
      
      const liqWarning = distanceToLiq < 10 ? '⚠️ ' : '';

      message += `${typeEmoji} *${position.symbol}* ⚡${position.leverage}x\n\n`;
      message += `💰 Entry: $${formatNumber(position.entryPrice, 4)}\n`;
      message += `📊 Current: $${formatNumber(data.price, 4)}\n`;
      message += `${pnlEmoji} P&L: ${sign}$${formatNumber(pnl)} (${sign}${formatNumber(roi)}%)\n\n`;
      
      if (position.takeProfit) {
        message += `🎯 TP: $${formatNumber(position.takeProfit, 4)}\n`;
      }
      if (position.stopLoss) {
        message += `🛑 SL: $${formatNumber(position.stopLoss, 4)}\n`;
      }
      
      message += `${liqWarning}⚠️ Liq: $${formatNumber(position.liquidationPrice, 4)}\n`;
      message += `💵 Margin: $${formatNumber(position.margin)}\n\n`;
      message += `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

      buttons.push([
        { 
          text: `${pnl >= 0 ? '🟢' : '🔴'} ${position.symbol} ${position.type}`, 
          callback_data: `view_position_${position.id}` 
        }
      ]);
    } catch (error) {
      console.error('Error fetching position data:', error.message);
    }
  }

  const totalEmoji = totalPnL >= 0 ? '🟢' : '🔴';
  message += `${totalEmoji} *TOTAL P&L: ${totalPnL >= 0 ? '+' : ''}$${formatNumber(totalPnL)}*\n\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━━━━━`;

  buttons.push([
    { text: '🔄 Refresh', callback_data: 'positions' },
    { text: '❌ Close All', callback_data: 'close_all_confirm' }
  ]);
  buttons.push([
    { text: '🏠 Main Menu', callback_data: 'menu' }
  ]);

  if (messageId) {
    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    }).catch(() => {});
  } else {
    bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons }
    });
  }
}

// ═══════════════════════════════════════════════════════════
// 👁️ VIEW SINGLE POSITION
// ═══════════════════════════════════════════════════════════

async function viewPosition(chatId, positionId, messageId) {
  const user = initUser(chatId);
  const position = user.positions.find(p => p.id === positionId);
  
  if (!position) {
    bot.answerCallbackQuery(query.id, { text: '❌ Position not found!', show_alert: true });
    return;
  }

  try {
    const data = await getCoinPrice(position.symbol);
    const { pnl, roi } = calculatePnL(position, data.price);
    
    const pnlEmoji = pnl >= 0 ? '🟢' : '🔴';
    const typeEmoji = position.type === 'LONG' ? '🟢 📈' : '🔴 📉';
    const sign = pnl >= 0 ? '+' : '';
    
    const duration = Math.floor((Date.now() - position.openTime) / 1000 / 60);
    const timeStr = duration < 60 ? `${duration}m` : `${Math.floor(duration / 60)}h ${duration % 60}m`;
    
    const priceChange = ((data.price - position.entryPrice) / position.entryPrice * 100);
    
    const message = `
╔═══════════════════════════╗
    ${typeEmoji} POSITION DETAILS
╚═══════════════════════════╝

📊 *${position.symbol}* ⚡${position.leverage}x

━━━━━━━━━━━━━━━━━━━━━━━━━

💰 *PRICES*

Entry Price: $${formatNumber(position.entryPrice, 4)}
Current Price: $${formatNumber(data.price, 4)}
Price Change: ${priceChange >= 0 ? '+' : ''}${formatNumber(priceChange)}%

━━━━━━━━━━━━━━━━━━━━━━━━━

${pnlEmoji} *PROFIT & LOSS*

P&L: *${sign}$${formatNumber(pnl)}*
ROI: *${sign}${formatNumber(roi)}%*

━━━━━━━━━━━━━━━━━━━━━━━━━

📋 *POSITION INFO*

Type: ${position.type}
Leverage: ${position.leverage}x
Margin: $${formatNumber(position.margin)}
Position Size: $${formatNumber(position.margin * position.leverage)}
Duration: ${timeStr}

━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 *ORDERS*

${position.takeProfit ? `✅ Take Profit: $${formatNumber(position.takeProfit, 4)}` : '❌ No TP set'}
${position.stopLoss ? `✅ Stop Loss: $${formatNumber(position.stopLoss, 4)}` : '❌ No SL set'}

━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ *RISK*

Liquidation: $${formatNumber(position.liquidationPrice, 4)}

━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = {
      inline_keyboard: [
        [
          { text: '🎯 Set TP/SL', callback_data: `set_tpsl_${position.id}` }
        ],
        [
          { text: '❌ Close Position', callback_data: `close_position_${position.id}` }
        ],
        [
          { text: '🔙 Back', callback_data: 'positions' },
          { text: '🏠 Home', callback_data: 'menu' }
        ]
      ]
    };

    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    }).catch(() => {});
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`, { reply_markup: getBackToMenu() });
  }
}

// ═══════════════════════════════════════════════════════════
// 🎯 NEW TRADE FLOW
// ═══════════════════════════════════════════════════════════

async function startNewTrade(chatId, symbol = null, messageId = null) {
  if (!symbol) {
    const message = `
╔═══════════════════════════╗
    🎯 START NEW TRADE
╚═══════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━

📝 *How to start:*

1️⃣ Type the coin symbol
   Example: BTC, ETH, SOL

2️⃣ Or use quick command:
   \`/trade BTC\`

━━━━━━━━━━━━━━━━━━━━━━━━━

💡 *Need help finding coins?*
Check the "🪙 Markets" section!

━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = {
      inline_keyboard: [
        [{ text: '🪙 Browse Markets', callback_data: 'markets' }],
        [{ text: '🏠 Main Menu', callback_data: 'menu' }]
      ]
    };

    if (messageId) {
      bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      }).catch(() => {});
    } else {
      bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    }
    return;
  }

  try {
    const loadingMsg = messageId 
      ? await bot.editMessageText('⏳ Loading...', { chat_id: chatId, message_id: messageId })
      : await bot.sendMessage(chatId, '⏳ Loading...');
    
    const msgId = messageId || loadingMsg.message_id;
    const data = await getCoinDetails(symbol);
    
    const emoji = data.priceChangePercent >= 0 ? '🟢' : '🔴';
    const sign = data.priceChangePercent >= 0 ? '+' : '';
    
    const message = `
╔═══════════════════════════╗
    ${emoji} ${data.symbol}
╚═══════════════════════════╝

💰 *Current Price*
   ${formatNumber(data.price, 4)}

━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *24h Performance*
   ${emoji} ${sign}${formatNumber(data.priceChangePercent)}%

📈 High: ${formatNumber(data.highPrice, 4)}
📉 Low: ${formatNumber(data.lowPrice, 4)}

━━━━━━━━━━━━━━━━━━━━━━━━━

💡 *Select Position Type:*

🟢 LONG - Profit when price goes UP
🔴 SHORT - Profit when price goes DOWN

━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: msgId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🟢 LONG', callback_data: `long_${data.symbol}` },
            { text: '🔴 SHORT', callback_data: `short_${data.symbol}` }
          ],
          [
            { text: '🏠 Home', callback_data: 'menu' }
          ]
        ]
      }
    }).catch(() => {});
  } catch (error) {
    bot.sendMessage(chatId, error.message, { reply_markup: getBackToMenu() });
  }
}

// ═══════════════════════════════════════════════════════════
// 💵 AMOUNT SELECTION
// ═══════════════════════════════════════════════════════════

function showAmountSelection(chatId, messageId, symbol, type) {
  const user = initUser(chatId);
  const emoji = type === 'long' ? '🟢 📈' : '🔴 📉';
  
  const quickAmounts = [50, 100, 250, 500, 1000, 2500];
  const buttons = [];
  
  quickAmounts.forEach(amt => {
    if (amt <= user.balance) {
      buttons.push([{ text: `${amt}`, callback_data: `amount_${amt}` }]);
    }
  });
  
  buttons.push([
    { text: `💰 Max (${formatNumber(user.balance)})`, callback_data: 'amount_max' }
  ]);
  buttons.push([
    { text: '✏️ Custom Amount', callback_data: 'amount_custom' }
  ]);
  buttons.push([
    { text: '🔙 Back', callback_data: `trade_${symbol}` }
  ]);

  const message = `
╔═══════════════════════════╗
    ${emoji} ${type.toUpperCase()} ${symbol}
╚═══════════════════════════╝

💼 *Available Balance*
   ${formatNumber(user.balance)}

━━━━━━━━━━━━━━━━━━━━━━━━━

💡 *Select Margin Amount:*

This is how much you want to risk on this trade.

━━━━━━━━━━━━━━━━━━━━━━━━━
  `.trim();

  bot.editMessageText(message, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  }).catch(() => {});
}

// ═══════════════════════════════════════════════════════════
// ⚡ LEVERAGE SELECTION
// ═══════════════════════════════════════════════════════════

function showLeverageSelection(chatId, messageId, state) {
  const emoji = state.action === 'long' ? '🟢 📈' : '🔴 📉';
  
  const leverages = [2, 5, 10, 20, 25, 50, 75, 100];
  const buttons = [];
  
  for (let i = 0; i < leverages.length; i += 2) {
    buttons.push([
      { text: `⚡${leverages[i]}x`, callback_data: `leverage_${leverages[i]}` },
      { text: `⚡${leverages[i + 1]}x`, callback_data: `leverage_${leverages[i + 1]}` }
    ]);
  }
  
  buttons.push([
    { text: '✏️ Custom Leverage', callback_data: 'leverage_custom' }
  ]);
  buttons.push([
    { text: '🔙 Back', callback_data: `${state.action}_${state.symbol}` }
  ]);

  const message = `
╔═══════════════════════════╗
    ${emoji} ${state.action.toUpperCase()} ${state.symbol}
╚═══════════════════════════╝

💵 *Margin Amount*
   ${formatNumber(state.amount)}

━━━━━━━━━━━━━━━━━━━━━━━━━

⚡ *Select Leverage:*

Higher leverage = Higher risk & reward
Lower leverage = Safer trading

━━━━━━━━━━━━━━━━━━━━━━━━━

💡 *Position Size Examples:*

2x → ${formatNumber(state.amount * 2)}
10x → ${formatNumber(state.amount * 10)}
50x → ${formatNumber(state.amount * 50)}

━━━━━━━━━━━━━━━━━━━━━━━━━
  `.trim();

  bot.editMessageText(message, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  }).catch(() => {});
}

// ═══════════════════════════════════════════════════════════
// ✅ TRADE CONFIRMATION
// ═══════════════════════════════════════════════════════════

async function showTradeConfirmation(chatId, messageId, state) {
  try {
    const data = await getCoinDetails(state.symbol);
    const positionSize = state.amount * state.leverage;
    const commission = calculateCommission(positionSize);
    const liquidationPrice = calculateLiquidationPrice(data.price, state.leverage, state.action.toUpperCase());
    
    const emoji = state.action === 'long' ? '🟢 📈' : '🔴 📉';
    
    const message = `
╔═══════════════════════════╗
    ${emoji} CONFIRM TRADE
╚═══════════════════════════╝

📊 *${state.symbol}*
${state.action.toUpperCase()} Position

━━━━━━━━━━━━━━━━━━━━━━━━━

💰 *PRICES*

Entry Price: ${formatNumber(data.price, 4)}
Liquidation: ${formatNumber(liquidationPrice, 4)}

━━━━━━━━━━━━━━━━━━━━━━━━━

💵 *POSITION DETAILS*

Margin: ${formatNumber(state.amount)}
Leverage: ${state.leverage}x
Position Size: ${formatNumber(positionSize)}
Commission: ${formatNumber(commission)}

━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *POTENTIAL P&L (1% move)*

🟢 Profit: +${formatNumber(positionSize * 0.01)}
🔴 Loss: -${formatNumber(positionSize * 0.01)}

━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ *RISK WARNING*

Max Loss: -${formatNumber(state.amount)} (margin)

━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Ready to open this position?
    `.trim();

    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ CONFIRM TRADE', callback_data: 'confirm_trade' }
          ],
          [
            { text: '❌ Cancel', callback_data: 'menu' }
          ]
        ]
      }
    }).catch(() => {});
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`, { reply_markup: getBackToMenu() });
  }
}

// ═══════════════════════════════════════════════════════════
// 🎯 SET TAKE PROFIT / STOP LOSS
// ═══════════════════════════════════════════════════════════

async function showTPSLSetup(chatId, messageId, positionId) {
  const user = initUser(chatId);
  const position = user.positions.find(p => p.id === positionId);
  
  if (!position) {
    bot.answerCallbackQuery(query.id, { text: '❌ Position not found!', show_alert: true });
    return;
  }

  try {
    const data = await getCoinPrice(position.symbol);
    const typeEmoji = position.type === 'LONG' ? '🟢 📈' : '🔴 📉';
    
    const suggestedTP = position.type === 'LONG'
      ? position.entryPrice * 1.1 // 10% above
      : position.entryPrice * 0.9; // 10% below
    
    const suggestedSL = position.type === 'LONG'
      ? position.entryPrice * 0.95 // 5% below
      : position.entryPrice * 1.05; // 5% above
    
    const message = `
╔═══════════════════════════╗
    ${typeEmoji} SET TP/SL
╚═══════════════════════════╝

📊 *${position.symbol}* ${position.type}

━━━━━━━━━━━━━━━━━━━━━━━━━

💰 *CURRENT PRICES*

Entry: ${formatNumber(position.entryPrice, 4)}
Current: ${formatNumber(data.price, 4)}

━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 *SUGGESTED LEVELS*

Take Profit: ${formatNumber(suggestedTP, 4)} (+10%)
Stop Loss: ${formatNumber(suggestedSL, 4)} (-5%)

━━━━━━━━━━━━━━━━━━━━━━━━━

💡 *What would you like to set?*

🎯 TP = Close position at profit
🛑 SL = Close position to limit loss

━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = {
      inline_keyboard: [
        [
          { text: '🎯 Set Take Profit', callback_data: `tp_input_${positionId}` },
        ],
        [
          { text: '🛑 Set Stop Loss', callback_data: `sl_input_${positionId}` }
        ],
        [
          { text: '⚡ Quick TP/SL (10%/5%)', callback_data: `quick_tpsl_${positionId}` }
        ],
        [
          { text: '🔙 Back', callback_data: `view_position_${positionId}` }
        ]
      ]
    };

    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    }).catch(() => {});
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`, { reply_markup: getBackToMenu() });
  }
}

// ═══════════════════════════════════════════════════════════
// 💼 EXECUTE TRADE
// ═══════════════════════════════════════════════════════════

async function executeTrade(chatId, state, messageId) {
  try {
    const user = initUser(chatId);
    const data = await getCoinDetails(state.symbol);
    
    if (state.amount > user.balance) {
      const errorMsg = `
╔═══════════════════════════╗
    ❌ INSUFFICIENT BALANCE
╚═══════════════════════════╝

Required: ${formatNumber(state.amount)}
Available: ${formatNumber(user.balance)}

━━━━━━━━━━━━━━━━━━━━━━━━━

Please select a lower amount.
      `.trim();
      
      bot.editMessageText(errorMsg, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: getBackToMenu()
      }).catch(() => {});
      return;
    }

    const positionSize = state.amount * state.leverage;
    const commission = calculateCommission(positionSize);
    const liquidationPrice = calculateLiquidationPrice(data.price, state.leverage, state.action.toUpperCase());

    const position = {
      id: Date.now(),
      symbol: data.symbol,
      type: state.action.toUpperCase(),
      entryPrice: data.price,
      amount: positionSize / data.price,
      margin: state.amount,
      leverage: state.leverage,
      liquidationPrice: liquidationPrice,
      takeProfit: null,
      stopLoss: null,
      openTime: Date.now(),
      commission: commission,
      currentPnL: 0
    };

    user.positions.push(position);
    user.balance -= state.amount;
    user.stats.totalCommission += commission;

    const emoji = state.action === 'long' ? '🟢' : '🔴';
    const typeEmoji = state.action === 'long' ? '🟢 📈' : '🔴 📉';
    
    const message = `
╔═══════════════════════════╗
    ${emoji} POSITION OPENED
╚═══════════════════════════╝

${typeEmoji} *${position.symbol}* ${position.type}

━━━━━━━━━━━━━━━━━━━━━━━━━

✅ *Position successfully opened!*

━━━━━━━━━━━━━━━━━━━━━━━━━

💰 *ENTRY DETAILS*

Entry Price: ${formatNumber(position.entryPrice, 4)}
Position Size: ${formatNumber(positionSize)}
Leverage: ${state.leverage}x
Margin Used: ${formatNumber(state.amount)}

━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ *RISK MANAGEMENT*

Liquidation: ${formatNumber(liquidationPrice, 4)}

💡 Set TP/SL to manage risk!

━━━━━━━━━━━━━━━━━━━━━━━━━

💼 *ACCOUNT*

New Balance: ${formatNumber(user.balance)}
Commission Paid: ${formatNumber(commission)}

━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🎯 Set TP/SL', callback_data: `set_tpsl_${position.id}` }
          ],
          [
            { text: '📊 View Position', callback_data: `view_position_${position.id}` }
          ],
          [
            { text: '🏠 Main Menu', callback_data: 'menu' }
          ]
        ]
      }
    }).catch(() => {});
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`, { reply_markup: getBackToMenu() });
  }
}

// ═══════════════════════════════════════════════════════════
// ❌ CLOSE POSITION
// ═══════════════════════════════════════════════════════════

async function closePosition(chatId, positionId, messageId) {
  const user = initUser(chatId);
  const position = user.positions.find(p => p.id === positionId);
  
  if (!position) {
    bot.answerCallbackQuery(query.id, { text: '❌ Position not found!', show_alert: true });
    return;
  }

  try {
    const data = await getCoinPrice(position.symbol);
    const { pnl, roi } = calculatePnL(position, data.price);
    const closeCommission = calculateCommission(position.margin * position.leverage);
    const netPnL = pnl - closeCommission;

    user.balance += position.margin + netPnL;
    user.stats.totalCommission += closeCommission;
    user.stats.totalTrades++;

    if (netPnL >= 0) {
      user.stats.winningTrades++;
      user.stats.totalProfit += netPnL;
      if (netPnL > user.stats.bestTrade) {
        user.stats.bestTrade = netPnL;
      }
    } else {
      user.stats.losingTrades++;
      user.stats.totalLoss += netPnL;
      if (netPnL < user.stats.worstTrade) {
        user.stats.worstTrade = netPnL;
      }
    }

    const trade = {
      ...position,
      exitPrice: data.price,
      closeTime: Date.now(),
      pnl: netPnL,
      roi: roi,
      status: 'CLOSED'
    };

    user.tradeHistory.push(trade);
    const index = user.positions.indexOf(position);
    user.positions.splice(index, 1);

    const resultEmoji = netPnL >= 0 ? '🟢' : '🔴';
    const typeEmoji = trade.type === 'LONG' ? '🟢 📈' : '🔴 📉';
    const sign = netPnL >= 0 ? '+' : '';
    const duration = Math.floor((trade.closeTime - trade.openTime) / 1000 / 60);
    const timeStr = duration < 60 ? `${duration}m` : `${Math.floor(duration / 60)}h ${duration % 60}m`;
    
    const message = `
╔═══════════════════════════╗
    ${resultEmoji} POSITION CLOSED
╚═══════════════════════════╝

${typeEmoji} *${trade.symbol}* ${trade.type}

━━━━━━━━━━━━━━━━━━━━━━━━━

${resultEmoji} *RESULT*

Net P&L: *${sign}${formatNumber(netPnL)}*
ROI: *${sign}${formatNumber(roi)}%*

━━━━━━━━━━━━━━━━━━━━━━━━━

💰 *PRICES*

Entry: ${formatNumber(trade.entryPrice, 4)}
Exit: ${formatNumber(trade.exitPrice, 4)}
Change: ${formatNumber(((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100)}%

━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *DETAILS*

Gross P&L: ${sign}${formatNumber(pnl)}
Commissions: -${formatNumber(closeCommission + position.commission)}
Duration: ${timeStr}

━━━━━━━━━━━━━━━━━━━━━━━━━

💼 *ACCOUNT*

New Balance: ${formatNumber(user.balance)}
Win Rate: ${user.stats.totalTrades > 0 ? ((user.stats.winningTrades / user.stats.totalTrades) * 100).toFixed(1) : 0}%

━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🎯 Trade Again', callback_data: `trade_${trade.symbol}` }
          ],
          [
            { text: '📊 View Positions', callback_data: 'positions' }
          ],
          [
            { text: '🏠 Main Menu', callback_data: 'menu' }
          ]
        ]
      }
    }).catch(() => {});
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`, { reply_markup: getBackToMenu() });
  }
}

// ═══════════════════════════════════════════════════════════
// 🪙 MARKETS VIEW
// ═══════════════════════════════════════════════════════════

async function showMarkets(chatId, messageId = null) {
  try {
    const loadingText = '⏳ Loading markets...';
    if (messageId) {
      await bot.editMessageText(loadingText, { chat_id: chatId, message_id: messageId });
    }

    const coins = await getTrendingCoins();
    
    let message = `
╔═══════════════════════════╗
    🪙 TRENDING MARKETS
╚═══════════════════════════╝

Top 15 by Volume

━━━━━━━━━━━━━━━━━━━━━━━━━

`;

    const buttons = [];
    
    coins.forEach((coin, index) => {
      const emoji = coin.priceChangePercent >= 0 ? '🟢' : '🔴';
      const sign = coin.priceChangePercent >= 0 ? '+' : '';
      const coinName = coin.symbol.replace('USDT', '');
      
      message += `${index + 1}. ${emoji} *${coinName}* ${sign}${formatNumber(coin.priceChangePercent)}%\n`;
      
      if ((index + 1) % 3 === 0) {
        message += `\n`;
      }
    });

    message += `\n━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    message += `💡 Select a coin to trade:`;

    for (let i = 0; i < coins.length; i += 2) {
      const row = [];
      const coin1 = coins[i].symbol.replace('USDT', '');
      row.push({ text: `${coin1}`, callback_data: `trade_${coins[i].symbol}` });
      
      if (coins[i + 1]) {
        const coin2 = coins[i + 1].symbol.replace('USDT', '');
        row.push({ text: `${coin2}`, callback_data: `trade_${coins[i + 1].symbol}` });
      }
      buttons.push(row);
    }

    buttons.push([
      { text: '🔄 Refresh', callback_data: 'markets' }
    ]);
    buttons.push([
      { text: '🏠 Main Menu', callback_data: 'menu' }
    ]);

    if (messageId) {
      bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      }).catch(() => {});
    } else {
      bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      });
    }
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`, { reply_markup: getBackToMenu() });
  }
}

// ═══════════════════════════════════════════════════════════
// 📜 TRADE HISTORY
// ═══════════════════════════════════════════════════════════

function showHistory(chatId, messageId = null) {
  const user = initUser(chatId);
  
  if (user.tradeHistory.length === 0) {
    const message = `
╔═══════════════════════════╗
    📜 TRADE HISTORY
╚═══════════════════════════╝

No completed trades yet.

━━━━━━━━━━━━━━━━━━━━━━━━━

💡 Start trading to build your history!

━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = {
      inline_keyboard: [
        [{ text: '🎯 Start Trading', callback_data: 'new_trade' }],
        [{ text: '🏠 Main Menu', callback_data: 'menu' }]
      ]
    };

    if (messageId) {
      bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      }).catch(() => {});
    } else {
      bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    }
    return;
  }

  const recentTrades = user.tradeHistory.slice(-10).reverse();
  let message = `
╔═══════════════════════════╗
    📜 TRADE HISTORY
╚═══════════════════════════╝

Last ${recentTrades.length} trades

━━━━━━━━━━━━━━━━━━━━━━━━━

`;

  recentTrades.forEach((trade, index) => {
    const emoji = trade.pnl >= 0 ? '🟢' : '🔴';
    const typeEmoji = trade.type === 'LONG' ? '📈' : '📉';
    const sign = trade.pnl >= 0 ? '+' : '';
    
    message += `${emoji} ${typeEmoji} *${trade.symbol}* ⚡${trade.leverage}x\n`;
    message += `   P&L: ${sign}${formatNumber(trade.pnl)} (${sign}${formatNumber(trade.roi)}%)\n`;
    message += `   ${formatTime(trade.closeTime)}\n\n`;
  });

  message += `━━━━━━━━━━━━━━━━━━━━━━━━━`;

  if (messageId) {
    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: getBackToMenu()
    }).catch(() => {});
  } else {
    bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: getBackToMenu()
    });
  }
}

// ═══════════════════════════════════════════════════════════
// 📈 ANALYSIS
// ═══════════════════════════════════════════════════════════

async function showAnalysis(chatId, messageId = null) {
  const user = initUser(chatId);
  
  if (user.stats.totalTrades === 0) {
    const message = `
╔═══════════════════════════╗
    📈 TRADING ANALYSIS
╚═══════════════════════════╝

No trading data available yet.

━━━━━━━━━━━━━━━━━━━━━━━━━

💡 Complete some trades to see your analysis!

━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    const keyboard = {
      inline_keyboard: [
        [{ text: '🎯 Start Trading', callback_data: 'new_trade' }],
        [{ text: '🏠 Main Menu', callback_data: 'menu' }]
      ]
    };

    if (messageId) {
      bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      }).catch(() => {});
    } else {
      bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    }
    return;
  }

  const winRate = ((user.stats.winningTrades / user.stats.totalTrades) * 100).toFixed(1);
  const avgProfit = user.stats.winningTrades > 0 
    ? (user.stats.totalProfit / user.stats.winningTrades).toFixed(2)
    : 0;
  const avgLoss = user.stats.losingTrades > 0
    ? (user.stats.totalLoss / user.stats.losingTrades).toFixed(2)
    : 0;
  const profitFactor = user.stats.totalLoss !== 0
    ? Math.abs(user.stats.totalProfit / user.stats.totalLoss).toFixed(2)
    : 0;
  
  const netPnL = user.stats.totalProfit + user.stats.totalLoss;
  const totalROI = ((netPnL / INITIAL_BALANCE) * 100).toFixed(2);
  
  const roiEmoji = netPnL >= 0 ? '🟢' : '🔴';
  
  let rating = '';
  if (winRate >= 60 && profitFactor >= 2) {
    rating = '🌟🌟🌟🌟🌟 Exceptional!';
  } else if (winRate >= 55 && profitFactor >= 1.5) {
    rating = '⭐⭐⭐⭐ Excellent!';
  } else if (winRate >= 50 && profitFactor >= 1.2) {
    rating = '⭐⭐⭐ Good!';

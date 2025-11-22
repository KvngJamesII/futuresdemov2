const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuration
const BOT_TOKEN = '8013538850:AAG1Hmi2LVEGmMte8zdxLGuBekTZLmOaoYY';
const GROUP_ID = '-1003378225304';
const API_TOKEN = 'QlZSNEVBcHJHbIuGSoxYZVZlk4iFamd1U2lYU0iLk4hfjnFCSXA=';
const API_URL = 'http://51.77.216.195/crapi/dgroup/viewstats';
const POLL_INTERVAL = 5000; // Check every 5 seconds
const SEEN_IDS_FILE = path.join(__dirname, 'seen_sms_ids.json');
const CHANNELS_FILE = path.join(__dirname, 'channels.json');

// Initialize bot
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Store seen SMS IDs
let seenSmsIds = new Set();

// Store channel IDs
let channels = [GROUP_ID]; // Default group

// Bot status
let isConnected = false;
let lastConnectionStatus = null;
let isInitialized = false; // Flag to track if initial load is done

// Load seen SMS IDs from file
function loadSeenIds() {
    try {
        if (fs.existsSync(SEEN_IDS_FILE)) {
            const data = fs.readFileSync(SEEN_IDS_FILE, 'utf8');
            const ids = JSON.parse(data);
            seenSmsIds = new Set(ids);
            console.log(`Loaded ${seenSmsIds.size} seen SMS IDs`);
        }
    } catch (error) {
        console.error('Error loading seen IDs:', error);
        seenSmsIds = new Set();
    }
}

// Save seen SMS IDs to file
function saveSeenIds() {
    try {
        const ids = Array.from(seenSmsIds);
        fs.writeFileSync(SEEN_IDS_FILE, JSON.stringify(ids, null, 2));
    } catch (error) {
        console.error('Error saving seen IDs:', error);
    }
}

// Load channels from file
function loadChannels() {
    try {
        if (fs.existsSync(CHANNELS_FILE)) {
            const data = fs.readFileSync(CHANNELS_FILE, 'utf8');
            const loadedChannels = JSON.parse(data);
            channels = loadedChannels;
            console.log(`Loaded ${channels.length} channel(s)`);
        }
    } catch (error) {
        console.error('Error loading channels:', error);
        channels = [GROUP_ID];
    }
}

// Save channels to file
function saveChannels() {
    try {
        fs.writeFileSync(CHANNELS_FILE, JSON.stringify(channels, null, 2));
    } catch (error) {
        console.error('Error saving channels:', error);
    }
}

// Generate unique ID for SMS (combination of timestamp, number, and message hash)
function generateSmsId(sms) {
    const crypto = require('crypto');
    const hash = crypto.createHash('md5')
        .update(`${sms.dt}|${sms.num}|${sms.message}`)
        .digest('hex');
    return hash;
}

// Extract OTP from message
function extractOTP(message) {
    // Common OTP patterns: looking for codes with hyphens or spaces too
    const otpPatterns = [
        /code[:\s]+([0-9-]+)/i,  // "code 461-731" or "code: 123456"
        /otp[:\s]+([0-9-]+)/i,   // "otp 461-731"
        /pin[:\s]+([0-9-]+)/i,   // "pin 461-731"
        /\b(\d{3}-\d{3})\b/,     // Format like 461-731
        /\b(\d{6,8})\b/,         // 6-8 digit continuous
        /\b(\d{4,5})\b/          // 4-5 digit
    ];

    for (const pattern of otpPatterns) {
        const match = message.match(pattern);
        if (match) {
            return match[1];
        }
    }
    return null;
}

// Mask phone number for privacy
function maskPhoneNumber(number) {
    if (number.length <= 4) return number;
    
    const start = number.slice(0, 3);
    const end = number.slice(-3);
    const middle = '**';
    
    return `${start}${middle}${end}`;
}

// Format and send SMS to group
async function sendSmsToGroup(sms) {
    try {
        const otp = extractOTP(sms.message);
        const maskedNumber = maskPhoneNumber(sms.num);
        
        let message = '━━━━━━━━━━━━━━━━━━\n';
        message += '🔔 *New OTP Received*\n';
        message += '━━━━━━━━━━━━━━━━━━\n\n';
        
        message += `📤 *Sender:* ${sms.cli}\n`;
        message += `━━━━━━━━━━━━━━━━━━\n\n`;
        
        message += `📱 *Number:* \`${maskedNumber}\`\n`;
        message += `━━━━━━━━━━━━━━━━━━\n\n`;
        
        if (otp) {
            message += `🔑 *OTP:* \`${otp}\`\n`;
            message += `━━━━━━━━━━━━━━━━━━\n\n`;
        }
        
        message += `📩 *Message:*\n`;
        message += `\`\`\`\n${sms.message}\n\`\`\`\n`;
        message += `━━━━━━━━━━━━━━━━━━\n\n`;
        
        message += `🕐 *Time:* ${sms.dt}\n`;
        message += '━━━━━━━━━━━━━━━━━━';

        // Send to all channels
        for (const channelId of channels) {
            try {
                await bot.sendMessage(channelId, message, {
                    parse_mode: 'Markdown'
                });
                console.log(`✓ Sent SMS to channel ${channelId}: ${sms.cli} -> ${maskedNumber}`);
            } catch (error) {
                console.error(`✗ Failed to send to channel ${channelId}:`, error.message);
            }
        }
    } catch (error) {
        console.error('Error sending SMS:', error);
    }
}

// Fetch SMS from API
async function fetchSms() {
    try {
        const response = await axios.get(API_URL, {
            params: {
                token: API_TOKEN,
                records: 10 // Fetch last 10 records to check for new ones
            },
            timeout: 10000
        });

        if (response.data.status === 'success') {
            // Update connection status
            if (!isConnected) {
                isConnected = true;
                await sendConnectionStatus(true);
            }

            const smsData = response.data.data || [];
            
            // On first initialization, just mark all current SMS as seen
            // Don't send them to the group
            if (!isInitialized) {
                console.log('Initial load: Marking existing SMS as seen...');
                for (const sms of smsData) {
                    const smsId = generateSmsId(sms);
                    seenSmsIds.add(smsId);
                }
                saveSeenIds();
                isInitialized = true;
                console.log(`✓ Initialized with ${seenSmsIds.size} existing SMS`);
                console.log('🎯 Now monitoring for NEW SMS only...');
                return true;
            }

            // After initialization, only send NEW SMS
            let newSmsCount = 0;
            // Process SMS in reverse order (oldest first)
            for (const sms of smsData.reverse()) {
                const smsId = generateSmsId(sms);
                
                if (!seenSmsIds.has(smsId)) {
                    seenSmsIds.add(smsId);
                    await sendSmsToGroup(sms);
                    newSmsCount++;
                    
                    // Small delay between messages
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            if (newSmsCount > 0) {
                saveSeenIds();
                console.log(`✓ Processed ${newSmsCount} new SMS`);
            }

            return true;
        } else {
            console.error('API Error:', response.data);
            return false;
        }
    } catch (error) {
        console.error('Error fetching SMS:', error.message);
        
        // Update connection status
        if (isConnected) {
            isConnected = false;
            await sendConnectionStatus(false);
        }
        
        return false;
    }
}

// Send connection status to group
async function sendConnectionStatus(connected) {
    try {
        // Prevent duplicate status messages
        if (lastConnectionStatus === connected) {
            return;
        }
        
        lastConnectionStatus = connected;
        
        const message = connected
            ? '✅ *Bot Connected*\n\nSMS monitoring is now active. Waiting for new SMS...'
            : '❌ *Bot Disconnected*\n\nSMS monitoring is currently unavailable. Attempting to reconnect...';

        // Send to all channels
        for (const channelId of channels) {
            try {
                await bot.sendMessage(channelId, message, {
                    parse_mode: 'Markdown'
                });
            } catch (error) {
                console.error(`Error sending status to channel ${channelId}:`, error.message);
            }
        }
    } catch (error) {
        console.error('Error sending connection status:', error);
    }
}

// Handle /status command
bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
        // Test API connection
        const response = await axios.get(API_URL, {
            params: {
                token: API_TOKEN,
                records: 1
            },
            timeout: 5000
        });

        const apiStatus = response.data.status === 'success';
        const statusEmoji = apiStatus ? '✅' : '❌';
        const statusText = apiStatus ? 'Active' : 'Error';
        const initStatus = isInitialized ? '✅ Ready' : '⏳ Initializing';
        
        const statusMessage = `
${statusEmoji} *Bot Status*

🤖 Bot: Active
🌐 API: ${statusText}
🎯 Status: ${initStatus}
📊 Tracked SMS: ${seenSmsIds.size}
📢 Active Channels: ${channels.length}
🕐 Last Check: ${new Date().toLocaleString()}
        `;

        await bot.sendMessage(chatId, statusMessage.trim(), {
            parse_mode: 'Markdown'
        });
    } catch (error) {
        await bot.sendMessage(chatId, '❌ *Bot Status*\n\n🤖 Bot: Active\n🌐 API: Connection Error', {
            parse_mode: 'Markdown'
        });
    }
});

// Handle /add command (add new channel)
bot.onText(/\/add (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const newChannelId = match[1].trim();
    
    // Only allow command from the main group
    if (chatId.toString() !== GROUP_ID) {
        await bot.sendMessage(chatId, '❌ This command can only be used in the main group.', {
            parse_mode: 'Markdown'
        });
        return;
    }
    
    // Check if channel already exists
    if (channels.includes(newChannelId)) {
        await bot.sendMessage(chatId, `⚠️ Channel \`${newChannelId}\` is already added.`, {
            parse_mode: 'Markdown'
        });
        return;
    }
    
    // Test if bot can send to this channel
    try {
        await bot.sendMessage(newChannelId, '✅ *Channel Added Successfully*\n\nThis channel will now receive SMS notifications.', {
            parse_mode: 'Markdown'
        });
        
        channels.push(newChannelId);
        saveChannels();
        
        await bot.sendMessage(chatId, `✅ Channel \`${newChannelId}\` added successfully!\n\n📢 Total channels: ${channels.length}`, {
            parse_mode: 'Markdown'
        });
        
        console.log(`✓ Added channel: ${newChannelId}`);
    } catch (error) {
        await bot.sendMessage(chatId, `❌ Failed to add channel \`${newChannelId}\`\n\nError: ${error.message}\n\nMake sure the bot is added as admin in the channel.`, {
            parse_mode: 'Markdown'
        });
        console.error(`✗ Failed to add channel ${newChannelId}:`, error.message);
    }
});

// Handle /remove command (remove channel)
bot.onText(/\/remove (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const channelIdToRemove = match[1].trim();
    
    // Only allow command from the main group
    if (chatId.toString() !== GROUP_ID) {
        await bot.sendMessage(chatId, '❌ This command can only be used in the main group.', {
            parse_mode: 'Markdown'
        });
        return;
    }
    
    // Check if it's the main group
    if (channelIdToRemove === GROUP_ID) {
        await bot.sendMessage(chatId, '❌ Cannot remove the main group!', {
            parse_mode: 'Markdown'
        });
        return;
    }
    
    // Check if channel exists
    const channelIndex = channels.indexOf(channelIdToRemove);
    if (channelIndex === -1) {
        await bot.sendMessage(chatId, `⚠️ Channel \`${channelIdToRemove}\` is not in the list.`, {
            parse_mode: 'Markdown'
        });
        return;
    }
    
    // Remove channel
    channels.splice(channelIndex, 1);
    saveChannels();
    
    try {
        await bot.sendMessage(channelIdToRemove, '👋 *Channel Removed*\n\nThis channel will no longer receive SMS notifications.', {
            parse_mode: 'Markdown'
        });
    } catch (error) {
        console.log(`Could not send removal message to ${channelIdToRemove}`);
    }
    
    await bot.sendMessage(chatId, `✅ Channel \`${channelIdToRemove}\` removed successfully!\n\n📢 Total channels: ${channels.length}`, {
        parse_mode: 'Markdown'
    });
    
    console.log(`✓ Removed channel: ${channelIdToRemove}`);
});

// Handle /list command (list all channels)
bot.onText(/\/list/, async (msg) => {
    const chatId = msg.chat.id;
    
    // Only allow command from the main group
    if (chatId.toString() !== GROUP_ID) {
        await bot.sendMessage(chatId, '❌ This command can only be used in the main group.', {
            parse_mode: 'Markdown'
        });
        return;
    }
    
    let message = '📢 *Active Channels*\n\n';
    
    channels.forEach((channel, index) => {
        const isMain = channel === GROUP_ID;
        message += `${index + 1}. \`${channel}\`${isMain ? ' *(Main)*' : ''}\n`;
    });
    
    message += `\n*Total:* ${channels.length} channel(s)`;
    
    await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown'
    });
});

// Handle /clear command (admin only - clears seen IDs)
bot.onText(/\/clear/, async (msg) => {
    const chatId = msg.chat.id;
    
    if (chatId.toString() === GROUP_ID) {
        const oldSize = seenSmsIds.size;
        seenSmsIds.clear();
        saveSeenIds();
        isInitialized = false; // Reset initialization flag
        
        await bot.sendMessage(chatId, `🗑️ Cleared ${oldSize} tracked SMS IDs\n\nBot will re-initialize on next check.`, {
            parse_mode: 'Markdown'
        });
    }
});

// Start polling for SMS
function startPolling() {
    console.log('🚀 Bot started successfully!');
    console.log(`📱 Monitoring SMS for group: ${GROUP_ID}`);
    console.log('⏳ Initializing... (loading existing SMS)');
    
    // Initial fetch
    fetchSms();
    
    // Poll at regular intervals
    setInterval(fetchSms, POLL_INTERVAL);
}

// Initialize
loadSeenIds();
loadChannels();
startPolling();

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down bot...');
    saveSeenIds();
    bot.stopPolling();
    process.exit(0);
});

console.log('🤖 Telegram SMS Bot initialized...');



const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } =
  require('discord.js');
const keepAlive = require('./keepalive');
const fs = require('fs').promises;
const path = require('path');
// Initialize client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// Data storage
let serverData = {};
const DATA_FILE = 'serverData.json';

// Load data from file
async function loadData() {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf8');
    serverData = JSON.parse(data);
    console.log('\ud83d\udcca Data loaded successfully');
  } catch (error) {
    console.log('\ud83d\udcdd Creating new data file');
    serverData = {};
  }
}

// Save data to file
async function saveData() {
  try {
    await fs.writeFile(DATA_FILE, JSON.stringify(serverData, null, 2));
  } catch (error) {
    console.error('\u274c Error saving data:', error);
  }
}

// Initialize server data
function initServerData(guildId) {
  if (!serverData[guildId]) {
    serverData[guildId] = {
      users: {},
      tasks: {},
      settings: {
        staffRoles: [],
        adminRoles: [],
        pointsChannel: null,
        dailyQuotes: [
          "Success is not final, failure is not fatal: it is the courage to continue that counts.",
          "The way to get started is to quit talking and begin doing.",
          "Innovation distinguishes between a leader and a follower.",
          "Your limitation\u2014it's only your imagination.",
          "Great things never come from comfort zones.",
          "Dream it. Wish it. Do it.",
          "Success doesn't just find you. You have to go out and get it.",
          "The harder you work for something, the greater you'll feel when you achieve it.",
          "Don't stop when you're tired. Stop when you're done.",
          "Wake up with determination. Go to bed with satisfaction."
        ]
      },
      activeTasks: {},
      lastDaily: {}
    };
  }
}

// Get user data
function getUserData(guildId, userId) {
  initServerData(guildId);
  if (!serverData[guildId].users[userId]) {
    serverData[guildId].users[userId] = {
      points: 0,
      tasksCompleted: 0,
      dailyStreak: 0,
      lastDailyQuote: null,
      joinDate: new Date().toISOString(),
      totalTasksStarted: 0,
      achievements: []
    };
  }
  return serverData[guildId].users[userId];
}

// Check if user is staff
function isStaff(member, guildId) {
  initServerData(guildId);
  const staffRoles = serverData[guildId].settings.staffRoles;
  return member.roles.cache.some(role => staffRoles.includes(role.id)) || member.permissions.has(PermissionFlagsBits.Administrator);
}

// Check if user is admin
function isAdmin(member, guildId) {
  initServerData(guildId);
  const adminRoles = serverData[guildId].settings.adminRoles;
  return member.permissions.has(PermissionFlagsBits.Administrator) || member.roles.cache.some(role => adminRoles.includes(role.id));
}

// Check for achievements
function checkAchievements(userData, guildId, userId) {
  const achievements = [
    { name: "First Steps", condition: () => userData.tasksCompleted >= 1, description: "Complete your first task" },
    { name: "Getting Started", condition: () => userData.tasksCompleted >= 5, description: "Complete 5 tasks" },
    { name: "Dedicated Staff", condition: () => userData.tasksCompleted >= 10, description: "Complete 10 tasks" },
    { name: "Task Master", condition: () => userData.tasksCompleted >= 25, description: "Complete 25 tasks" },
    { name: "Workaholic", condition: () => userData.tasksCompleted >= 50, description: "Complete 50 tasks" },
    { name: "Centurion", condition: () => userData.tasksCompleted >= 100, description: "Complete 100 tasks" },
    { name: "Point Collector", condition: () => userData.points >= 100, description: "Earn 100 points" },
    { name: "Rising Star", condition: () => userData.points >= 500, description: "Earn 500 points" },
    { name: "Elite Staff", condition: () => userData.points >= 1000, description: "Earn 1000 points" },
    { name: "Legendary Staff", condition: () => userData.points >= 5000, description: "Earn 5000 points" },
    { name: "Consistent", condition: () => userData.dailyStreak >= 3, description: "Maintain a 3-day streak" },
    { name: "Dedicated", condition: () => userData.dailyStreak >= 7, description: "Maintain a 7-day streak" },
    { name: "Committed", condition: () => userData.dailyStreak >= 14, description: "Maintain a 14-day streak" },
    { name: "Unstoppable", condition: () => userData.dailyStreak >= 30, description: "Maintain a 30-day streak" }
  ];

  for (const achievement of achievements) {
    if (achievement.condition() && !userData.achievements.includes(achievement.name)) {
      userData.achievements.push(achievement.name);

      // Send achievement notification if pointsChannel is set
      const pointsChannelId = serverData[guildId].settings.pointsChannel;
      if (pointsChannelId) {
        const channel = client.channels.cache.get(pointsChannelId);
        if (channel) {
          const embed = new EmbedBuilder()
            .setColor('#ffd700')
            .setTitle('\ud83c\udfc6 Achievement Unlocked!')
            .setDescription(`<@${userId}> has earned the **${achievement.name}** achievement!`)
            .addFields({ name: '\ud83d\udcdd Description', value: achievement.description })
            .setTimestamp();

          channel.send({ embeds: [embed] }).catch(console.error);
        }
      }
    }
  }
}

// Send notification to points channel
async function sendPointsNotification(guildId, userId, points, reason) {
  const pointsChannelId = serverData[guildId].settings.pointsChannel;
  if (!pointsChannelId) return;

  const channel = client.channels.cache.get(pointsChannelId);
  if (!channel) return;

  const user = await client.users.fetch(userId).catch(() => null);
  if (!user) return;

  const embed = new EmbedBuilder()
    .setColor(points >= 0 ? '#00ff00' : '#ff0000')
    .setTitle(points >= 0 ? '\ud83d\udcb0 Points Added' : '\ud83d\udcb8 Points Removed')
    .setDescription(`<@${userId}> ${points >= 0 ? 'received' : 'lost'} **${Math.abs(points)}** points${reason ? ` for: ${reason}` : ''}`)
    .addFields({ name: '\ud83d\udcca New Total', value: serverData[guildId].users[userId].points.toString() })
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(console.error);
}

// Auto-complete task based on criteria
async function autoCompleteTask(interaction, guildId, userId, taskName, taskData) {
  const task = serverData[guildId].tasks[taskName];
  if (!task) return false;

  // Increment the completed actions counter
  taskData.completedActions = (taskData.completedActions || 0) + 1;

  // Check if we've reached the required number of actions
  const requiredActions = task.requiredActions || 1;
  const isComplete = taskData.completedActions >= requiredActions;

  // Check for task type and auto-complete based on criteria
  if (task.type === 'send_message' && task.channelId) {
    // This would be handled by a message event listener
    return isComplete;
  }

  if (task.type === 'check_channel' && task.channelId) {
    // This would be handled by checking if user viewed the channel
    return isComplete;
  }

  // Default behavior - auto-complete if required actions are met
  return isComplete;
}

// Slash commands
const commands = [
  // Staff Commands
  new SlashCommandBuilder()
    .setName('starttask')
    .setDescription('Start a task to earn points')
    .addStringOption(option =>
      option.setName('task')
        .setDescription('Select a task to start')
        .setRequired(true)
        .setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName('completetask')
    .setDescription('Complete your active task')
    .addStringOption(option =>
      option.setName('task')
        .setDescription('Select a task to complete')
        .setRequired(false)
        .setAutocomplete(true))
    .addStringOption(option =>
      option.setName('proof')
        .setDescription('Provide proof of task completion')
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName('mytasks')
    .setDescription('View your active tasks'),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('View the points leaderboard')
    .addIntegerOption(option =>
      option.setName('page')
        .setDescription('Page number')
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName('topten')
    .setDescription('View top 10 staff members'),

  new SlashCommandBuilder()
    .setName('dailyquote')
    .setDescription('Get your daily motivational quote and bonus points'),

  new SlashCommandBuilder()
    .setName('profile')
    .setDescription('View your staff profile')
    .addUserOption(option =>
      option.setName('user')
        .setDescription("View another user's profile")
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('View all available commands'),

  new SlashCommandBuilder()
    .setName('achievements')
    .setDescription('View your achievements')
    .addUserOption(option =>
      option.setName('user')
        .setDescription("View another user's achievements")
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName('taskinfo')
    .setDescription('Get information about a specific task')
    .addStringOption(option =>
      option.setName('task')
        .setDescription('Select a task to view info')
        .setRequired(true)
        .setAutocomplete(true)),

  // Admin Commands
  new SlashCommandBuilder()
    .setName('addtask')
    .setDescription('Add a new task (Admin only)')
    .addStringOption(option =>
      option.setName('name')
        .setDescription('Task name')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('description')
        .setDescription('Task description')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('points')
        .setDescription('Points reward')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('required_actions')
        .setDescription('Number of required actions to complete (1-50)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(50))
    .addStringOption(option =>
      option.setName('type')
        .setDescription('Task type')
        .setRequired(false)
        .addChoices(
          { name: 'Manual', value: 'manual' },
          { name: 'Send Message', value: 'send_message' },
          { name: 'Check Channel', value: 'check_channel' },
          { name: 'Upload Image', value: 'upload_image' },
          { name: 'React to Messages', value: 'react_messages' },
          { name: 'Join Voice Channel', value: 'join_voice' },
          { name: 'Create Thread', value: 'create_thread' },
          { name: 'Pin Message', value: 'pin_message' },
          { name: 'Add Role', value: 'add_role' },
          { name: 'Remove Role', value: 'remove_role' },
          { name: 'Kick Member', value: 'kick_member' },
          { name: 'Ban Member', value: 'ban_member' },
          { name: 'Timeout Member', value: 'timeout_member' },
          { name: 'Delete Messages', value: 'delete_messages' },
          { name: 'Create Invite', value: 'create_invite' },
          { name: 'Edit Message', value: 'edit_message' },
          { name: 'Use Slash Command', value: 'use_slash_command' },
          { name: 'Create Poll', value: 'create_poll' },
          { name: 'Start Event', value: 'start_event' },
          { name: 'Moderate Chat', value: 'moderate_chat' },
          { name: 'Help Members', value: 'help_members' },
          { name: 'Update Server', value: 'update_server' },
          { name: 'Review Reports', value: 'review_reports' },
          { name: 'Host Activity', value: 'host_activity' },
          { name: 'Welcome Members', value: 'welcome_members' }
        ))
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Channel for task (if applicable)')
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName('removetask')
    .setDescription('Remove a task (Admin only)')
    .addStringOption(option =>
      option.setName('task')
        .setDescription('Select task to remove')
        .setRequired(true)
        .setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName('addpoints')
    .setDescription('Add points to a user (Admin only)')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('User to add points to')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('points')
        .setDescription('Points to add')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for adding points')
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName('removepoints')
    .setDescription('Remove points from a user (Admin only)')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('User to remove points from')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('points')
        .setDescription('Points to remove')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for removing points')
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName('resetleaderboard')
    .setDescription('Reset the leaderboard (Admin only)')
    .addBooleanOption(option =>
      option.setName('confirm')
        .setDescription('Confirm reset (type true)')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('setstaffrole')
    .setDescription('Set staff roles (Admin only)')
    .addRoleOption(option =>
      option.setName('role')
        .setDescription('Role to add as staff')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('setadminrole')
    .setDescription('Set admin roles (Admin only)')
    .addRoleOption(option =>
      option.setName('role')
        .setDescription('Role to add as admin')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('viewtasks')
    .setDescription('View all available tasks (Admin only)'),

  new SlashCommandBuilder()
    .setName('serverstats')
    .setDescription('View server statistics (Admin only)'),

  new SlashCommandBuilder()
    .setName('setpointschannel')
    .setDescription('Set the channel for points notifications (Admin only)')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Channel for points notifications')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('adddailyquote')
    .setDescription('Add a new daily quote (Admin only)')
    .addStringOption(option =>
      option.setName('quote')
        .setDescription('The quote to add')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('removedailyquote')
    .setDescription('Remove a daily quote (Admin only)')
    .addIntegerOption(option =>
      option.setName('index')
        .setDescription('Index of the quote to remove')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('viewdailyquotes')
    .setDescription('View all daily quotes (Admin only)')
];

// Bot ready event
client.once('ready', async () => {
  console.log(`\ud83e\udd16 ${client.user.tag} is online!`);

  await loadData();

  // Register slash commands
  try {
    console.log('\ud83d\udd04 Refreshing slash commands...');
    await client.application.commands.set(commands);
    console.log('\u2705 Slash commands registered successfully!');
  } catch (error) {
    console.error('\u274c Error registering commands:', error);
  }

  // Set bot status
  client.user.setActivity('Managing Staff Points', { type: 'WATCHING' });
});

// Autocomplete handler
client.on('interactionCreate', async interaction => {
  if (!interaction.isAutocomplete()) return;

  const { commandName, options } = interaction;
  const guildId = interaction.guild.id;
  initServerData(guildId);

  if (commandName === 'starttask' || commandName === 'removetask' || commandName === 'taskinfo') {
    const focusedValue = options.getFocused();
    const tasks = serverData[guildId].tasks;

    const filtered = Object.entries(tasks)
      .filter(([name]) => name.toLowerCase().includes(focusedValue.toLowerCase()))
      .slice(0, 25)
      .map(([name, task]) => ({
        name: `${name} (${task.points} points)`,
        value: name
      }));

    await interaction.respond(filtered);
  } else if (commandName === 'completetask') {
    const focusedValue = options.getFocused();
    const userId = interaction.user.id;
    const activeTasks = serverData[guildId].activeTasks[userId] || {};

    const filtered = Object.keys(activeTasks)
      .filter(name => name.toLowerCase().includes(focusedValue.toLowerCase()))
      .slice(0, 25)
      .map(name => ({
        name: name,
        value: name
      }));

    await interaction.respond(filtered);
  }
});

// Message event handler for auto-completion of message tasks
client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const guildId = message.guild?.id;
  if (!guildId) return;

  initServerData(guildId);
  const userId = message.author.id;

  // Check if user is staff
  const member = await message.guild.members.fetch(userId).catch(() => null);
  if (!member || !isStaff(member, guildId)) return;

  // Check active tasks
  const activeTasks = serverData[guildId].activeTasks[userId] || {};

  for (const [taskName, taskData] of Object.entries(activeTasks)) {
    const task = serverData[guildId].tasks[taskName];
    if (!task) continue;

    // Check if this is a message task and in the correct channel
    if (task.type === 'send_message' && task.channelId === message.channel.id) {
      // Increment the completed actions counter
      taskData.completedActions = (taskData.completedActions || 0) + 1;

      // Check if we've reached the required number of actions
      const requiredActions = task.requiredActions || 1;

      if (taskData.completedActions >= requiredActions) {
        // Auto-complete the task when required actions are met
        const userData = getUserData(guildId, userId);
        userData.points += task.points;
        userData.tasksCompleted++;
        delete serverData[guildId].activeTasks[userId][taskName];

        // Check for achievements
        checkAchievements(userData, guildId, userId);

        await saveData();

        // Send notification
        const embed = new EmbedBuilder()
          .setColor('#00ff00')
          .setTitle('\u2705 Task Auto-Completed!')
          .setDescription(`You've completed the task: **${taskName}**`)
          .addFields(
            { name: '\ud83d\udcb0 Points Earned', value: task.points.toString(), inline: true },
            { name: '\ud83d\udcca Total Points', value: userData.points.toString(), inline: true }
          )
          .setTimestamp();

        message.author.send({ embeds: [embed] }).catch(() => {
          // If DM fails, try to send in the channel
          message.reply({ embeds: [embed], ephemeral: true }).catch(console.error);
        });

        // Send to points channel if configured
        sendPointsNotification(guildId, userId, task.points, `completing task: ${taskName}`);
      } else {
        // Send progress update
        const embed = new EmbedBuilder()
          .setColor('#ffcc00')
          .setTitle('\ud83d\udd04 Task Progress Updated')
          .setDescription(`Progress on task: **${taskName}**`)
          .addFields(
            { name: '\ud83c\udfaf Progress', value: `${taskData.completedActions}/${requiredActions} actions completed`, inline: true }
          )
          .setFooter({ text: `Complete ${requiredActions - taskData.completedActions} more action(s) to finish this task.` })
          .setTimestamp();

        // Only send progress updates at certain intervals to avoid spam
        if (taskData.completedActions === 1 || taskData.completedActions % 5 === 0 || 
            taskData.completedActions === Math.floor(requiredActions / 2) || 
            taskData.completedActions === requiredActions - 1) {
          message.author.send({ embeds: [embed] }).catch(() => {
            // Don't send to channel to avoid spam
          });
        }
      }

      await saveData();
      break; // Only update one task per message
    }
  }
});

// Command handler
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, options, member, guild, user } = interaction;
  const guildId = guild.id;
  const userId = user.id;

  initServerData(guildId);

  try {
    switch (commandName) {
      case 'starttask': {
        if (!isStaff(member, guildId)) {
          return interaction.reply({ content: '\u274c You need to be a staff member to use this command!', ephemeral: true });
        }

        const taskName = options.getString('task');
        const task = serverData[guildId].tasks[taskName];

        if (!task) {
          return interaction.reply({ content: '\u274c Task not found!', ephemeral: true });
        }

        // Check if user already has this task active
        if (serverData[guildId].activeTasks[userId] && serverData[guildId].activeTasks[userId][taskName]) {
          return interaction.reply({ content: '\u274c You already have this task active!', ephemeral: true });
        }

        // Initialize active tasks for user
        if (!serverData[guildId].activeTasks[userId]) {
          serverData[guildId].activeTasks[userId] = {};
        }

        const startTime = Date.now();

        serverData[guildId].activeTasks[userId][taskName] = {
          startTime,
          points: task.points,
          requiredActions: task.requiredActions || 1,
          completedActions: 0
        };

        const userData = getUserData(guildId, userId);
        userData.totalTasksStarted++;

        await saveData();

        const embed = new EmbedBuilder()
          .setColor('#00ff00')
          .setTitle('\ud83d\udccb Task Started!')
          .setDescription(`**${taskName}**\
${task.description}`)
          .addFields(
            { name: '\ud83d\udcb0 Points Reward', value: task.points.toString(), inline: true },
            { name: '\ud83c\udfaf Required Actions', value: (task.requiredActions || 1).toString(), inline: true },
            { name: '\ud83d\ude80 Started', value: `<t:${Math.floor(startTime / 1000)}:R>`, inline: true }
          )
          .setFooter({ text: 'Some tasks auto-complete based on actions. Others require /completetask command.' })
          .setTimestamp();

        // Check for auto-completion
        if (task.type && task.type !== 'manual') {
          embed.addFields({ name: '\u2699\ufe0f Auto-Complete', value: 'This task will auto-complete when conditions are met.', inline: true });

          // Try to auto-complete immediately if possible
          const autoCompleted = await autoCompleteTask(interaction, guildId, userId, taskName, serverData[guildId].activeTasks[userId][taskName]);

          if (autoCompleted) {
            // Task was auto-completed
            userData.points += task.points;
            userData.tasksCompleted++;
            delete serverData[guildId].activeTasks[userId][taskName];

            // Check for achievements
            checkAchievements(userData, guildId, userId);

            await saveData();

            // Update embed to show completion
            embed.setTitle('\u2705 Task Auto-Completed!');
            embed.setColor('#ffd700');
            embed.addFields({ name: '\ud83d\udcca Total Points', value: userData.points.toString(), inline: true });

            // Send notification to points channel
            sendPointsNotification(guildId, userId, task.points, `completing task: ${taskName}`);
          }
        }

        await interaction.reply({ embeds: [embed] });
        break;
      }

      case 'completetask': {
        if (!isStaff(member, guildId)) {
          return interaction.reply({ content: '\u274c You need to be a staff member to use this command!', ephemeral: true });
        }

        const activeTasks = serverData[guildId].activeTasks[userId];
        if (!activeTasks || Object.keys(activeTasks).length === 0) {
          return interaction.reply({ content: '\u274c You do not have any active tasks!', ephemeral: true });
        }

        const taskName = options.getString('task');
        const proof = options.getString('proof') || 'No proof provided';
        const userData = getUserData(guildId, userId);

        // If specific task is provided
        if (taskName) {
          if (!activeTasks[taskName]) {
            return interaction.reply({ content: `\u274c You don't have an active task named "${taskName}"!`, ephemeral: true });
          }

          const taskData = activeTasks[taskName];
          const task = serverData[guildId].tasks[taskName];

          if (!task) {
            return interaction.reply({ content: '\u274c Task not found in database!', ephemeral: true });
          }

          // Increment the completed actions counter
          taskData.completedActions = (taskData.completedActions || 0) + 1;

          // Check if the required actions have been completed
          const requiredActions = task.requiredActions || 1;
          const isTaskCompleted = taskData.completedActions >= requiredActions;

          await saveData();

          if (isTaskCompleted) {
            // Complete the task if all required actions are done
            const points = taskData.points;
            userData.points += points;
            userData.tasksCompleted++;
            delete serverData[guildId].activeTasks[userId][taskName];

            // Check for achievements
            checkAchievements(userData, guildId, userId);

            await saveData();

            const embed = new EmbedBuilder()
              .setColor('#00ff00')
              .setTitle('\u2705 Task Completed!')
              .setDescription(`You've completed the task: **${taskName}**`)
              .addFields(
                { name: '\ud83d\udcb0 Points Earned', value: points.toString(), inline: true },
                { name: '\ud83d\udcca Total Points', value: userData.points.toString(), inline: true },
                { name: '\ud83d\udccb Tasks Completed', value: userData.tasksCompleted.toString(), inline: true },
                { name: '\ud83d\udcdd Proof', value: proof }
              )
              .setTimestamp();

            await interaction.reply({ embeds: [embed] });

            // Send notification to points channel
            sendPointsNotification(guildId, userId, points, `completing task: ${taskName}`);
          } else {
            // Task not yet completed, show progress
            const embed = new EmbedBuilder()
              .setColor('#ffcc00')
              .setTitle('\ud83d\udd04 Task Progress Updated')
              .setDescription(`Progress on task: **${taskName}**`)
              .addFields(
                { name: '\ud83c\udfaf Progress', value: `${taskData.completedActions}/${requiredActions} actions completed`, inline: true },
                { name: '\ud83d\udcdd Proof', value: proof }
              )
              .setFooter({ text: `Complete ${requiredActions - taskData.completedActions} more action(s) to finish this task.` })
              .setTimestamp();

            await interaction.reply({ embeds: [embed] });
          }
        } else {
          // Handle completing all tasks with progress tracking
          let totalPoints = 0;
          let completedTasks = [];
          let inProgressTasks = [];

          for (const [taskName, taskData] of Object.entries(activeTasks)) {
            const task = serverData[guildId].tasks[taskName];
            if (!task) continue;

            // Increment the completed actions counter for each task
            taskData.completedActions = (taskData.completedActions || 0) + 1;
            const requiredActions = task.requiredActions || 1;

            if (taskData.completedActions >= requiredActions) {
              // This task is now complete
              const points = taskData.points;
              totalPoints += points;
              completedTasks.push({ name: taskName, points });
              userData.tasksCompleted++;
              delete serverData[guildId].activeTasks[userId][taskName];
            } else {
              // This task is still in progress
              inProgressTasks.push({ 
                name: taskName, 
                progress: `${taskData.completedActions}/${requiredActions}` 
              });
            }
          }

          userData.points += totalPoints;

          // Check for achievements
          checkAchievements(userData, guildId, userId);

          await saveData();

          const embed = new EmbedBuilder()
            .setColor(completedTasks.length > 0 ? '#00ff00' : '#ffcc00')
            .setTitle(completedTasks.length > 0 ? '\u2705 Tasks Updated' : '\ud83d\udd04 Tasks Progress Updated')
            .setDescription(`You've made progress on your tasks.`)
            .addFields(
              { name: '\ud83d\udcb0 Points Earned', value: totalPoints.toString(), inline: true },
              { name: '\ud83d\udcca Total Points', value: userData.points.toString(), inline: true },
              { name: '\ud83d\udcdd Proof', value: proof }
            )
            .setTimestamp();

          if (completedTasks.length > 0) {
            const taskList = completedTasks.map(task => `\u2022 ${task.name} (+${task.points} points)`).join('\
');
            embed.addFields({ name: '\u2705 Completed Tasks', value: taskList || 'None' });
          }

          if (inProgressTasks.length > 0) {
            const taskList = inProgressTasks.map(task => `\u2022 ${task.name} (Progress: ${task.progress})`).join('\
');
            embed.addFields({ name: '\ud83d\udd04 In-Progress Tasks', value: taskList });
          }

          await interaction.reply({ embeds: [embed] });

          // Send notification to points channel if points were earned
          if (totalPoints > 0) {
            sendPointsNotification(guildId, userId, totalPoints, `completing ${completedTasks.length} tasks`);
          }
        }
        break;
      }

      case 'mytasks': {
        if (!isStaff(member, guildId)) {
          return interaction.reply({ content: '\u274c You need to be a staff member to use this command!', ephemeral: true });
        }

        const activeTasks = serverData[guildId].activeTasks[userId];

        if (!activeTasks || Object.keys(activeTasks).length === 0) {
          return interaction.reply({ content: '\ud83d\udccb You do not have any active tasks. Use `/starttask` to start one!', ephemeral: true });
        }

        const embed = new EmbedBuilder()
          .setColor('#0099ff')
          .setTitle('\ud83d\udccb Your Active Tasks')
          .setTimestamp();

        let description = '';
        for (const [taskName, taskData] of Object.entries(activeTasks)) {
          const task = serverData[guildId].tasks[taskName];
          description += `**${taskName}**\
`;
          description += `${task ? task.description : 'No description'}\
`;
          description += `\ud83d\udcb0 Points: ${taskData.points}\
`;
          description += `\ud83c\udfaf Progress: ${taskData.completedActions || 0}/${taskData.requiredActions || 1}\
`;
          description += `\ud83d\ude80 Started: <t:${Math.floor(taskData.startTime / 1000)}:R>\
`;

          if (task && task.type && task.type !== 'manual') {
            description += `\u2699\ufe0f Auto-Complete: This task will auto-complete when conditions are met.\
`;
          }

          description += '\
';
        }

        embed.setDescription(description);
        await interaction.reply({ embeds: [embed], ephemeral: true });
        break;
      }

      case 'leaderboard': {
        const page = options.getInteger('page') || 1;
        const usersPerPage = 10;
        const startIndex = (page - 1) * usersPerPage;

        const users = Object.entries(serverData[guildId].users)
          .sort(([,a], [,b]) => b.points - a.points)
          .slice(startIndex, startIndex + usersPerPage);

        if (users.length === 0) {
          return interaction.reply({ content: '\ud83d\udcca No users found on this page!', ephemeral: true });
        }

        const embed = new EmbedBuilder()
          .setColor('#ffd700')
          .setTitle('\ud83c\udfc6 Staff Points Leaderboard')
          .setFooter({ text: `Page ${page} \u2022 Use /leaderboard page:<number> to navigate` })
          .setTimestamp();

        let description = '';
        for (let i = 0; i < users.length; i++) {
          const [userId, userData] = users[i];
          const rank = startIndex + i + 1;
          const user = await client.users.fetch(userId).catch(() => null);
          const username = user ? user.username : 'Unknown User';

          let medal = '';
          if (rank === 1) medal = '\ud83e\udd47';
          else if (rank === 2) medal = '\ud83e\udd48';
          else if (rank === 3) medal = '\ud83e\udd49';
          else medal = `**${rank}.**`;

          description += `${medal} ${username} - **${userData.points}** points (${userData.tasksCompleted} tasks)\
`;
        }

        embed.setDescription(description);
        await interaction.reply({ embeds: [embed] });
        break;
      }

      case 'topten': {
        const users = Object.entries(serverData[guildId].users)
          .sort(([,a], [,b]) => b.points - a.points)
          .slice(0, 10);

        if (users.length === 0) {
          return interaction.reply({ content: '\ud83d\udcca No users found!', ephemeral: true });
        }

        const embed = new EmbedBuilder()
          .setColor('#ffd700')
          .setTitle('\ud83c\udfc6 Top 10 Staff Members')
          .setTimestamp();

        let description = '';
        for (let i = 0; i < users.length; i++) {
          const [userId, userData] = users[i];
          const user = await client.users.fetch(userId).catch(() => null);
          const username = user ? user.username : 'Unknown User';

          let medal = '';
          if (i === 0) medal = '\ud83e\udd47';
          else if (i === 1) medal = '\ud83e\udd48';
          else if (i === 2) medal = '\ud83e\udd49';
          else medal = `**${i + 1}.**`;

          description += `${medal} ${username} - **${userData.points}** points\
`;
        }

        embed.setDescription(description);
        await interaction.reply({ embeds: [embed] });
        break;
      }

      case 'dailyquote': {
        if (!isStaff(member, guildId)) {
          return interaction.reply({ content: '\u274c You need to be a staff member to use this command!', ephemeral: true });
        }

        const userData = getUserData(guildId, userId);
        const today = new Date().toDateString();

        if (userData.lastDailyQuote === today) {
          return interaction.reply({ content: '\u274c You have already claimed your daily quote today! Come back tomorrow.', ephemeral: true });
        }

        const quotes = serverData[guildId].settings.dailyQuotes;
        const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
        const bonusPoints = 10;

        userData.points += bonusPoints;
        userData.lastDailyQuote = today;

        // Update daily streak
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayString = yesterday.toDateString();

        if (userData.lastDailyQuote === yesterdayString) {
          userData.dailyStreak++;
        } else {
          userData.dailyStreak = 1;
        }

        // Check for achievements
        checkAchievements(userData, guildId, userId);

        await saveData();

        const embed = new EmbedBuilder()
          .setColor('#ff6b6b')
          .setTitle('\ud83d\udcad Daily Motivational Quote')
          .setDescription(`*"${randomQuote}"*`)
          .addFields(
            { name: '\ud83d\udcb0 Bonus Points', value: `+${bonusPoints} points`, inline: true },
            { name: '\ud83d\udcca Total Points', value: userData.points.toString(), inline: true },
            { name: '\ud83d\udd25 Daily Streak', value: userData.dailyStreak.toString(), inline: true }
          )
          .setFooter({ text: 'Come back tomorrow for another quote and bonus points!' })
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });

        // Send notification to points channel
        sendPointsNotification(guildId, userId, bonusPoints, 'daily quote bonus');
        break;
      }

      case 'profile': {
        const targetUser = options.getUser('user') || user;
        const targetUserId = targetUser.id;
        const userData = getUserData(guildId, targetUserId);

        // Calculate rank
        const allUsers = Object.entries(serverData[guildId].users)
          .sort(([,a], [,b]) => b.points - a.points);
        const rank = allUsers.findIndex(([id]) => id === targetUserId) + 1;

        const embed = new EmbedBuilder()
          .setColor('#0099ff')
          .setTitle(`\ud83d\udcca ${targetUser.username}'s Staff Profile`)
          .setThumbnail(targetUser.displayAvatarURL())
          .addFields(
            { name: '\ud83d\udcb0 Total Points', value: userData.points.toString(), inline: true },
            { name: '\ud83d\udccb Tasks Completed', value: userData.tasksCompleted.toString(), inline: true },
            { name: '\ud83c\udfc6 Rank', value: rank > 0 ? `#${rank}` : 'Unranked', inline: true },
            { name: '\ud83d\udd25 Daily Streak', value: userData.dailyStreak.toString(), inline: true },
            { name: '\ud83d\ude80 Tasks Started', value: userData.totalTasksStarted.toString(), inline: true },
            { name: '\ud83c\udfc5 Achievements', value: userData.achievements.length.toString(), inline: true },
            { name: '\ud83d\udcc5 Joined', value: `<t:${Math.floor(new Date(userData.joinDate).getTime() / 1000)}:D>`, inline: true }
          )
          .setTimestamp();

        // Show recent achievements
        if (userData.achievements.length > 0) {
          const recentAchievements = userData.achievements.slice(-3).join(', ');
          embed.addFields({ name: '\ud83c\udfc6 Recent Achievements', value: recentAchievements });
        }

        await interaction.reply({ embeds: [embed] });
        break;
      }

      case 'help': {
        const isStaffMember = isStaff(member, guildId);
        const isAdminMember = isAdmin(member, guildId);

        const embed = new EmbedBuilder()
          .setColor('#0099ff')
          .setTitle('\ud83d\udcda Staff Points Bot - Help')
          .setDescription('Here are all the available commands:')
          .setTimestamp();

        if (isStaffMember) {
          embed.addFields({
            name: '\ud83d\udc65 Staff Commands',
            value: `
\`/starttask\` - Start a task to earn points
\`/completetask\` - Complete your active task
\`/mytasks\` - View your active tasks
\`/leaderboard\` - View the points leaderboard
\`/topten\` - View top 10 staff members
\`/dailyquote\` - Get daily motivational quote and bonus points
\`/profile\` - View your or another user's profile
\`/achievements\` - View your achievements
\`/taskinfo\` - Get information about a specific task
\`/help\` - Show this help message
            `,
            inline: false
          });
        }

        if (isAdminMember) {
          embed.addFields({
            name: '\u2699\ufe0f Admin Commands',
            value: `
\`/addtask\` - Add a new task
\`/removetask\` - Remove a task
\`/addpoints\` - Add points to a user
\`/removepoints\` - Remove points from a user
\`/resetleaderboard\` - Reset the leaderboard
\`/setstaffrole\` - Set staff roles
\`/setadminrole\` - Set admin roles
\`/viewtasks\` - View all available tasks
\`/serverstats\` - View server statistics
\`/setpointschannel\` - Set points notification channel
\`/adddailyquote\` - Add a new daily quote
\`/removedailyquote\` - Remove a daily quote
\`/viewdailyquotes\` - View all daily quotes
        `,
        inline: false
        });
        if (isStaffMember) {
        embed.addFields({
          name: '\ud83d\udc65 Credits',
          value: `
            Testers: @jdjsb0227 @goforgreatness
            Helper: @minlinithiel005
            Creator: @dukethecoolkid
            Debugging Assistance: @NinjaTech AI
            Owner: @dukethecoolkid
            Suggestor: @rd_meridian
            Special Thanks: @dukethecoolkid @NinjaTech AI @jdjsb0227 @goforgreatness @minlinithiel005 @rd_meridian
            `,
          inline: false
        });
        }
        }

        if (!isStaffMember) {
        embed.setDescription('\u274c You need to be a staff member to use this bot!');
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
        break;
        }

      case 'achievements': {
        const targetUser = options.getUser('user') || user;
        const targetUserId = targetUser.id;
        const userData = getUserData(guildId, targetUserId);

        const allAchievements = [
          { name: "First Steps", condition: () => userData.tasksCompleted >= 1, description: "Complete your first task" },
          { name: "Getting Started", condition: () => userData.tasksCompleted >= 5, description: "Complete 5 tasks" },
          { name: "Dedicated Staff", condition: () => userData.tasksCompleted >= 10, description: "Complete 10 tasks" },
          { name: "Task Master", condition: () => userData.tasksCompleted >= 25, description: "Complete 25 tasks" },
          { name: "Workaholic", condition: () => userData.tasksCompleted >= 50, description: "Complete 50 tasks" },
          { name: "Centurion", condition: () => userData.tasksCompleted >= 100, description: "Complete 100 tasks" },
          { name: "Point Collector", condition: () => userData.points >= 100, description: "Earn 100 points" },
          { name: "Rising Star", condition: () => userData.points >= 500, description: "Earn 500 points" },
          { name: "Elite Staff", condition: () => userData.points >= 1000, description: "Earn 1000 points" },
          { name: "Legendary Staff", condition: () => userData.points >= 5000, description: "Earn 5000 points" },
          { name: "Consistent", condition: () => userData.dailyStreak >= 3, description: "Maintain a 3-day streak" },
          { name: "Dedicated", condition: () => userData.dailyStreak >= 7, description: "Maintain a 7-day streak" },
          { name: "Committed", condition: () => userData.dailyStreak >= 14, description: "Maintain a 14-day streak" },
          { name: "Unstoppable", condition: () => userData.dailyStreak >= 30, description: "Maintain a 30-day streak" }
        ];

        const embed = new EmbedBuilder()
          .setColor('#ffd700')
          .setTitle(`\ud83c\udfc6 ${targetUser.username}'s Achievements`)
          .setThumbnail(targetUser.displayAvatarURL())
          .setTimestamp();

        let unlockedAchievements = '';
        let lockedAchievements = '';

        for (const achievement of allAchievements) {
          if (userData.achievements.includes(achievement.name)) {
            unlockedAchievements += `\u2705 **${achievement.name}** - ${achievement.description}\
`;
          } else {
            lockedAchievements += `\ud83d\udd12 **${achievement.name}** - ${achievement.description}\
`;
          }
        }

        if (unlockedAchievements) {
          embed.addFields({ name: '\ud83c\udfc6 Unlocked Achievements', value: unlockedAchievements });
        }

        if (lockedAchievements) {
          embed.addFields({ name: '\ud83d\udd12 Locked Achievements', value: lockedAchievements });
        }

        embed.addFields({ 
          name: '\ud83d\udcca Progress', 
          value: `${userData.achievements.length}/${allAchievements.length} achievements unlocked` 
        });

        await interaction.reply({ embeds: [embed] });
        break;
      }

      case 'taskinfo': {
        const taskName = options.getString('task');
        const task = serverData[guildId].tasks[taskName];

        if (!task) {
          return interaction.reply({ content: '\u274c Task not found!', ephemeral: true });
        }

        const embed = new EmbedBuilder()
          .setColor('#0099ff')
          .setTitle(`\ud83d\udccb Task Information: ${taskName}`)
          .setDescription(task.description)
          .addFields(
            { name: '\ud83d\udcb0 Points Reward', value: task.points.toString(), inline: true },
            { name: '\ud83c\udfaf Required Actions', value: (task.requiredActions || 1).toString(), inline: true },
            { name: '\u2699\ufe0f Type', value: task.type || 'manual', inline: true }
          )
          .setTimestamp();

        if (task.channelId) {
          embed.addFields({ name: '\ud83d\udccd Channel', value: `<#${task.channelId}>`, inline: true });
        }

        // Check if user has this task active
        if (serverData[guildId].activeTasks[userId] && serverData[guildId].activeTasks[userId][taskName]) {
          const taskData = serverData[guildId].activeTasks[userId][taskName];
          embed.addFields({ 
            name: '\ud83d\ude80 Your Progress', 
            value: `Started: <t:${Math.floor(taskData.startTime / 1000)}:R>\
Progress: ${taskData.completedActions || 0}/${taskData.requiredActions || 1}`,
            inline: false 
          });
        }

        await interaction.reply({ embeds: [embed] });
        break;
      }

      // Admin Commands
      case 'addtask': {
        if (!isAdmin(member, guildId)) {
          return interaction.reply({ content: '\u274c You need admin permissions to use this command!', ephemeral: true });
        }

        const name = options.getString('name');
        const description = options.getString('description');
        const points = options.getInteger('points');
        const requiredActions = options.getInteger('required_actions');
        const type = options.getString('type') || 'manual';
        const channel = options.getChannel('channel');

        if (serverData[guildId].tasks[name]) {
          return interaction.reply({ content: '\u274c A task with this name already exists!', ephemeral: true });
        }

        serverData[guildId].tasks[name] = {
          description,
          points,
          requiredActions,
          type,
          channelId: channel?.id || null,
          createdBy: userId,
          createdAt: new Date().toISOString()
        };

        await saveData();

        const embed = new EmbedBuilder()
          .setColor('#00ff00')
          .setTitle('\u2705 Task Added Successfully!')
          .addFields(
            { name: '\ud83d\udccb Name', value: name, inline: true },
            { name: '\ud83d\udcb0 Points', value: points.toString(), inline: true },
            { name: '\ud83c\udfaf Required Actions', value: requiredActions.toString(), inline: true },
            { name: '\u2699\ufe0f Type', value: type, inline: true },
            { name: '\ud83d\udcdd Description', value: description, inline: false }
          )
          .setTimestamp();

        if (channel) {
          embed.addFields({ name: '\ud83d\udccd Channel', value: channel.toString(), inline: true });
        }

        await interaction.reply({ embeds: [embed] });
        break;
      }

      case 'removetask': {
        if (!isAdmin(member, guildId)) {
          return interaction.reply({ content: '\u274c You need admin permissions to use this command!', ephemeral: true });
        }

        const taskName = options.getString('task');

        if (!serverData[guildId].tasks[taskName]) {
          return interaction.reply({ content: '\u274c Task not found!', ephemeral: true });
        }

        delete serverData[guildId].tasks[taskName];

        // Remove from all active tasks
        for (const userId in serverData[guildId].activeTasks) {
          if (serverData[guildId].activeTasks[userId][taskName]) {
            delete serverData[guildId].activeTasks[userId][taskName];
          }
        }

        await saveData();

        const embed = new EmbedBuilder()
          .setColor('#ff0000')
          .setTitle('\ud83d\uddd1\ufe0f Task Removed')
          .setDescription(`Task "${taskName}" has been removed successfully.`)
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });
        break;
      }

      case 'addpoints': {
        if (!isAdmin(member, guildId)) {
          return interaction.reply({ content: '\u274c You need admin permissions to use this command!', ephemeral: true });
        }

        const targetUser = options.getUser('user');
        const points = options.getInteger('points');
        const reason = options.getString('reason') || 'Manual adjustment by admin';

        const userData = getUserData(guildId, targetUser.id);
        userData.points += points;

        // Check for achievements
        checkAchievements(userData, guildId, targetUser.id);

        await saveData();

        const embed = new EmbedBuilder()
          .setColor('#00ff00')
          .setTitle('\ud83d\udcb0 Points Added')
          .setDescription(`Added **${points}** points to ${targetUser.username}`)
          .addFields(
            { name: '\ud83d\udcca New Total', value: userData.points.toString(), inline: true },
            { name: '\ud83d\udcdd Reason', value: reason, inline: false }
          )
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });

        // Send notification to points channel
        sendPointsNotification(guildId, targetUser.id, points, reason);
        break;
      }

      case 'removepoints': {
        if (!isAdmin(member, guildId)) {
          return interaction.reply({ content: '\u274c You need admin permissions to use this command!', ephemeral: true });
        }

        const targetUser = options.getUser('user');
        const points = options.getInteger('points');
        const reason = options.getString('reason') || 'Manual adjustment by admin';

        const userData = getUserData(guildId, targetUser.id);
        userData.points = Math.max(0, userData.points - points);

        await saveData();

        const embed = new EmbedBuilder()
          .setColor('#ff0000')
          .setTitle('\ud83d\udcb8 Points Removed')
          .setDescription(`Removed **${points}** points from ${targetUser.username}`)
          .addFields(
            { name: '\ud83d\udcca New Total', value: userData.points.toString(), inline: true },
            { name: '\ud83d\udcdd Reason', value: reason, inline: false }
          )
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });

        // Send notification to points channel
        sendPointsNotification(guildId, targetUser.id, -points, reason);
        break;
      }

      case 'resetleaderboard': {
        if (!isAdmin(member, guildId)) {
          return interaction.reply({ content: '\u274c You need admin permissions to use this command!', ephemeral: true });
        }

        const confirm = options.getBoolean('confirm');

        if (!confirm) {
          return interaction.reply({ content: '\u274c You must confirm the reset by setting the confirm option to true!', ephemeral: true });
        }

        serverData[guildId].users = {};
        serverData[guildId].activeTasks = {};

        await saveData();

        const embed = new EmbedBuilder()
          .setColor('#ff0000')
          .setTitle('\ud83d\udd04 Leaderboard Reset')
          .setDescription('The leaderboard has been reset successfully. All user data has been cleared.')
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });
        break;
      }

      case 'setstaffrole': {
        if (!isAdmin(member, guildId)) {
          return interaction.reply({ content: '\u274c You need admin permissions to use this command!', ephemeral: true });
        }

        const role = options.getRole('role');

        if (!serverData[guildId].settings.staffRoles.includes(role.id)) {
          serverData[guildId].settings.staffRoles.push(role.id);
          await saveData();

          const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('\u2705 Staff Role Added')
            .setDescription(`${role.name} has been added as a staff role.`)
            .setTimestamp();

          await interaction.reply({ embeds: [embed] });
        } else {
          return interaction.reply({ content: '\u274c This role is already set as a staff role!', ephemeral: true });
        }
        break;
      }

      case 'setadminrole': {
        if (!isAdmin(member, guildId)) {
          return interaction.reply({ content: '\u274c You need admin permissions to use this command!', ephemeral: true });
        }

        const role = options.getRole('role');

        if (!serverData[guildId].settings.adminRoles.includes(role.id)) {
          serverData[guildId].settings.adminRoles.push(role.id);
          await saveData();

          const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('\u2705 Admin Role Added')
            .setDescription(`${role.name} has been added as an admin role.`)
            .setTimestamp();

          await interaction.reply({ embeds: [embed] });
        } else {
          return interaction.reply({ content: '\u274c This role is already set as an admin role!', ephemeral: true });
        }
        break;
      }

      case 'viewtasks': {
        if (!isAdmin(member, guildId)) {
          return interaction.reply({ content: '\u274c You need admin permissions to use this command!', ephemeral: true });
        }

        const tasks = serverData[guildId].tasks;

        if (Object.keys(tasks).length === 0) {
          return interaction.reply({ content: '\ud83d\udccb No tasks have been created yet!', ephemeral: true });
        }

        const embed = new EmbedBuilder()
          .setColor('#0099ff')
          .setTitle('\ud83d\udccb All Available Tasks')
          .setTimestamp();

        let description = '';
        for (const [name, task] of Object.entries(tasks)) {
          description += `**${name}** (${task.points} points)\
`;
          description += `${task.description}\
`;
          description += `Type: ${task.type || 'manual'} | Actions: ${task.requiredActions || 1}\
`;
          if (task.channelId) {
            description += `Channel: <#${task.channelId}>\
`;
          }
          description += '\
';
        }

        embed.setDescription(description);
        await interaction.reply({ embeds: [embed], ephemeral: true });
        break;
      }

      case 'serverstats': {
        if (!isAdmin(member, guildId)) {
          return interaction.reply({ content: '\u274c You need admin permissions to use this command!', ephemeral: true });
        }

        const users = Object.values(serverData[guildId].users);
        const totalUsers = users.length;
        const totalPoints = users.reduce((sum, user) => sum + user.points, 0);
        const totalTasks = users.reduce((sum, user) => sum + user.tasksCompleted, 0);
        const totalActiveTasks = Object.values(serverData[guildId].activeTasks).reduce((sum, userTasks) => sum + Object.keys(userTasks).length, 0);
        const availableTasks = Object.keys(serverData[guildId].tasks).length;

        const embed = new EmbedBuilder()
          .setColor('#0099ff')
          .setTitle('\ud83d\udcca Server Statistics')
          .addFields(
            { name: '\ud83d\udc65 Total Users', value: totalUsers.toString(), inline: true },
            { name: '\ud83d\udcb0 Total Points Earned', value: totalPoints.toString(), inline: true },
            { name: '\ud83d\udccb Total Tasks Completed', value: totalTasks.toString(), inline: true },
            { name: '\ud83d\ude80 Active Tasks', value: totalActiveTasks.toString(), inline: true },
            { name: '\ud83d\udcdd Available Tasks', value: availableTasks.toString(), inline: true },
            { name: '\ud83c\udfc6 Staff Roles', value: serverData[guildId].settings.staffRoles.length.toString(), inline: true }
          )
          .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
        break;
      }

      case 'setpointschannel': {
        if (!isAdmin(member, guildId)) {
          return interaction.reply({ content: '\u274c You need admin permissions to use this command!', ephemeral: true });
        }

        const channel = options.getChannel('channel');

        serverData[guildId].settings.pointsChannel = channel.id;
        await saveData();

        const embed = new EmbedBuilder()
          .setColor('#00ff00')
          .setTitle('\u2705 Points Channel Set')
          .setDescription(`Points notifications will now be sent to ${channel}`)
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });
        break;
      }

      case 'adddailyquote': {
        if (!isAdmin(member, guildId)) {
          return interaction.reply({ content: '\u274c You need admin permissions to use this command!', ephemeral: true });
        }

        const quote = options.getString('quote');

        serverData[guildId].settings.dailyQuotes.push(quote);
        await saveData();

        const embed = new EmbedBuilder()
          .setColor('#00ff00')
          .setTitle('\u2705 Daily Quote Added')
          .setDescription(`Quote added: "${quote}"`)
          .addFields({ name: '\ud83d\udcca Total Quotes', value: serverData[guildId].settings.dailyQuotes.length.toString() })
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });
        break;
      }

      case 'removedailyquote': {
        if (!isAdmin(member, guildId)) {
          return interaction.reply({ content: '\u274c You need admin permissions to use this command!', ephemeral: true });
        }

        const index = options.getInteger('index') - 1; // Convert to 0-based index
        const quotes = serverData[guildId].settings.dailyQuotes;

        if (index < 0 || index >= quotes.length) {
          return interaction.reply({ content: '\u274c Invalid quote index!', ephemeral: true });
        }

        const removedQuote = quotes.splice(index, 1)[0];
        await saveData();

        const embed = new EmbedBuilder()
          .setColor('#ff0000')
          .setTitle('\ud83d\uddd1\ufe0f Daily Quote Removed')
          .setDescription(`Removed quote: "${removedQuote}"`)
          .addFields({ name: '\ud83d\udcca Remaining Quotes', value: quotes.length.toString() })
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });
        break;
      }

      case 'viewdailyquotes': {
        if (!isAdmin(member, guildId)) {
          return interaction.reply({ content: '\u274c You need admin permissions to use this command!', ephemeral: true });
        }

        const quotes = serverData[guildId].settings.dailyQuotes;

        if (quotes.length === 0) {
          return interaction.reply({ content: '\ud83d\udcdd No daily quotes have been added yet!', ephemeral: true });
        }

        const embed = new EmbedBuilder()
          .setColor('#0099ff')
          .setTitle('\ud83d\udcad All Daily Quotes')
          .setTimestamp();

        let description = '';
        for (let i = 0; i < quotes.length; i++) {
          description += `**${i + 1}.** "${quotes[i]}"\
\
`;
        }

        embed.setDescription(description);
        await interaction.reply({ embeds: [embed], ephemeral: true });
        break;
      }

      default:
        await interaction.reply({ content: '\u274c Unknown command!', ephemeral: true });
    }
  } catch (error) {
    console.error('Command error:', error);
    if (!interaction.replied) {
      await interaction.reply({ content: '\u274c An error occurred while processing your command!', ephemeral: true });
    }
  }
});

// Error handling
process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
  console.error('Uncaught exception:', error);
});

// Start the bot
keepAlive();
client.login(process.env.TOKEN);

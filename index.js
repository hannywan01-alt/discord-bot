const { Client, GatewayIntentBits, SlashCommandBuilder, Routes, REST } = require("discord.js");

const token = process.env.DISCORD_TOKEN;
const clientId = "1478734611319230474"; // from Discord Developer Portal

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const cooldowns = new Map();

const commands = [
  new SlashCommandBuilder()
    .setName("bump")
    .setDescription("Bump your server to the top of the listing")
].map(command => command.toJSON());

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(token);

  try {
    await rest.put(
      Routes.applicationCommands(clientId),
      { body: commands }
    );
    console.log("Slash command registered");
  } catch (error) {
    console.error(error);
  }
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "bump") {
    const guildId = interaction.guild.id;
    const now = Date.now();
    const cooldownAmount = 2 * 60 * 60 * 1000; // 2 hours

    if (cooldowns.has(guildId)) {
      const expirationTime = cooldowns.get(guildId) + cooldownAmount;

      if (now < expirationTime) {
        const remaining = Math.round((expirationTime - now) / 60000);
        return interaction.reply({
          content: `⏳ This server was recently bumped. Try again in **${remaining} minutes**.`,
          ephemeral: true
        });
      }
    }

    cooldowns.set(guildId, now);

    await interaction.reply({
      content: `🚀 **${interaction.guild.name} has been bumped!**\nThis server is now at the top of the listing.`,
    });
  }
});

client.login(token);

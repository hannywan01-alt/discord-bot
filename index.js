const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  Routes,
  REST
} = require("discord.js");

const { createClient } = require("@supabase/supabase-js");

// ====== CONFIG ======
const TEST_GUILD_ID = "1247512602897027132"; // your server id (for instant slash commands)
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID || "1478734611319230474"; // Application ID as string

// Supabase (add these to Render env vars)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!token) throw new Error("Missing DISCORD_TOKEN env var");
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// ====== COOLDOWNS (in-memory) ======
const bumpCooldowns = new Map(); // guildId -> last bump timestamp
const TWO_HOURS = 2 * 60 * 60 * 1000;

// ====== SLASH COMMANDS ======
const commands = [
  new SlashCommandBuilder()
    .setName("submit")
    .setDescription("Submit this server to the listing")
    .addStringOption(option =>
      option
        .setName("invite")
        .setDescription("Your server invite link (discord.gg/...)")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("description")
        .setDescription("Short description of your server")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("bump")
    .setDescription("Bump your server to the top of the listing (2h cooldown)")
].map(cmd => cmd.toJSON());

// ====== REGISTER COMMANDS (FAST: GUILD) ======
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(token);

  try {
    await rest.put(
      Routes.applicationGuildCommands(clientId, TEST_GUILD_ID),
      { body: commands }
    );
    console.log("Slash commands registered (guild)");
  } catch (error) {
    console.error("Slash command registration error:", error);
  }
});

// ====== HELPERS ======
function looksLikeDiscordInvite(invite) {
  return invite.includes("discord.gg/") || invite.includes("discord.com/invite/");
}

// ====== COMMAND HANDLERS ======
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // guard against DMs
  if (!interaction.guild) {
    return interaction.reply({ content: "Use this command inside a server.", ephemeral: true });
  }

  // /submit
  if (interaction.commandName === "submit") {
    const invite = interaction.options.getString("invite", true);
    const description = interaction.options.getString("description", true);

    if (!looksLikeDiscordInvite(invite)) {
      return interaction.reply({
        content: "❌ That invite link doesn’t look valid. Use a discord.gg or discord.com/invite link.",
        ephemeral: true
      });
    }

    if (description.length > 180) {
      return interaction.reply({
        content: "❌ Keep the description under 180 characters so it looks good on listings.",
        ephemeral: true
      });
    }

    const guildId = interaction.guild.id;
    const guildName = interaction.guild.name;
    const ownerId = interaction.guild.ownerId;

    const { error } = await supabase
      .from("servers")
      .upsert({
        guild_id: guildId,
        name: guildName,
        invite_url: invite,
        description: description,
        owner_id: ownerId
      });

    if (error) {
      console.error(error);
      return interaction.reply({ content: "❌ Failed to submit server.", ephemeral: true });
    }

    return interaction.reply(`✅ **${guildName}** has been submitted to the listing! Now use **/bump** every 2 hours.`);
  }

  // /bump
  if (interaction.commandName === "bump") {
    const guildId = interaction.guild.id;
    const now = Date.now();

    // Require submit first (check DB)
    const { data: server, error: fetchError } = await supabase
      .from("servers")
      .select("guild_id, name, invite_url, description, last_bumped_at, bump_count")
      .eq("guild_id", guildId)
      .maybeSingle();

    if (fetchError) {
      console.error(fetchError);
      return interaction.reply({ content: "❌ Could not check listing status.", ephemeral: true });
    }

    if (!server) {
      return interaction.reply({ content: "❌ This server isn’t listed yet. Use **/submit** first.", ephemeral: true });
    }

    // Cooldown (in-memory)
    const lastLocal = bumpCooldowns.get(guildId) || 0;
    if (lastLocal && now - lastLocal < TWO_HOURS) {
      const remaining = Math.ceil((TWO_HOURS - (now - lastLocal)) / 60000);
      return interaction.reply({
        content: `⏳ This server was recently bumped. Try again in **${remaining} minutes**.`,
        ephemeral: true
      });
    }

    bumpCooldowns.set(guildId, now);

    // Update DB
    const { error: updateError } = await supabase
      .from("servers")
      .update({
        last_bumped_at: new Date().toISOString(),
        bump_count: (server.bump_count || 0) + 1
      })
      .eq("guild_id", guildId);

    if (updateError) {
      console.error(updateError);
      return interaction.reply({ content: "❌ Failed to bump server in database.", ephemeral: true });
    }

    return interaction.reply({
      content: `🚀 **${interaction.guild.name} has been bumped!**\nInvite: ${server.invite_url}`
    });
  }
});

client.login(token);

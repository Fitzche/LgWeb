package fr.fitzche.lgmore.commands;

import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.scheduler.BukkitRunnable;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import fr.fitzche.lgmore.Main;
import fr.fitzche.lgmore.PlayerData;
import fr.fitzche.lgmore.Lg.GameNote;
import net.md_5.bungee.api.ChatColor;

/**
 * Commande /lga export — envoie les PlayerData vers le site web LgMore.
 *
 * Usage :
 *   /lga export                 → exporte TOUS les joueurs connus
 *   /lga export [nomDuJoueur]   → exporte un seul joueur
 *   /lga export online          → exporte tous les joueurs connectés
 *
 * Prérequis dans config.yml (ou à hard-coder ci-dessous) :
 *   lgmore-site-url: "http://votre-serveur:3000"
 *   lgmore-admin-key: "lgmore-admin-key-changeme"
 */
public class ExportCommand implements CommandExecutor {

    // ── À configurer ──────────────────────────────────────────────
    // Idéalement, lire depuis config.yml :
    //   private static final String SITE_URL  = Main.plug.getConfig().getString("lgmore-site-url", "http://localhost:3000");
    //   private static final String ADMIN_KEY = Main.plug.getConfig().getString("lgmore-admin-key", "changeme");
    private static final String SITE_URL  = "http://localhost:3000";
    private static final String ADMIN_KEY = "lgmore-admin-key-changeme";
    private static final Gson   GSON      = new GsonBuilder().serializeNulls().create();

    @Override
    public boolean onCommand(CommandSender sender, Command cmd, String label, String[] args) {

        // Permission check
        if (!sender.hasPermission("lgop") && !sender.isOp()) {
            sender.sendMessage(ChatColor.RED + "Permission insuffisante.");
            return true;
        }

        // Construire la liste des joueurs à exporter
        List<PlayerData> toExport = new ArrayList<>();

        if (args.length == 0) {
            // Tous les joueurs connus
            toExport.addAll(Main.strToPlayer.values());
            sender.sendMessage(Main.info + ChatColor.GREEN + "Export de tous les joueurs (" + toExport.size() + ")...");

        } else if (args[0].equalsIgnoreCase("online")) {
            for (PlayerData p : Main.strToPlayer.values()) {
                if (p.isOnline) toExport.add(p);
            }
            sender.sendMessage(Main.info + ChatColor.GREEN + "Export des joueurs en ligne (" + toExport.size() + ")...");

        } else {
            String name = args[0].toLowerCase();
            PlayerData p = Main.strToPlayer.getOrDefault(args[0], Main.strToPlayer.getOrDefault(name, null));
            if (p == null) {
                sender.sendMessage(ChatColor.RED + "Joueur introuvable : " + args[0]);
                return true;
            }
            toExport.add(p);
            sender.sendMessage(Main.info + ChatColor.GREEN + "Export de " + p.getName() + "...");
        }

        // Sérialisation + envoi HTTP en async (ne jamais bloquer le thread principal)
        final List<PlayerData> finalList = toExport;
        new BukkitRunnable() {
            @Override
            public void run() {
                try {
                    String json = buildPayload(finalList);
                    int status  = postToSite(json);

                    // Retourner sur le thread principal pour le message
                    new BukkitRunnable() {
                        @Override public void run() {
                            if (status == 200) {
                                sender.sendMessage(Main.info + ChatColor.GREEN
                                        + "✔ Export réussi (" + finalList.size() + " joueur(s)) → " + SITE_URL);
                            } else {
                                sender.sendMessage(ChatColor.RED
                                        + "✘ Export échoué (HTTP " + status + "). Vérifiez l'URL et la clé admin.");
                            }
                        }
                    }.runTask(Main.plug);

                } catch (Exception e) {
                    e.printStackTrace();
                    new BukkitRunnable() {
                        @Override public void run() {
                            sender.sendMessage(ChatColor.RED + "✘ Erreur réseau : " + e.getMessage());
                        }
                    }.runTask(Main.plug);
                }
            }
        }.runTaskAsynchronously(Main.plug);

        return true;
    }

    /**
     * Construit le JSON payload à envoyer.
     * Convertit les PlayerData en objets simples (pas de sérialisation Java complète,
     * juste les champs utiles pour le site web).
     */
    private String buildPayload(List<PlayerData> players) {
        List<Map<String, Object>> list = new ArrayList<>();

        for (PlayerData p : players) {
            Map<String, Object> map = new HashMap<>();
            map.put("Name",            p.getName());
            map.put("xp",              p.xp);
            map.put("feathers",        p.feathers);
            map.put("hasSpaceUsed",    p.hasSpaceUsed);
            map.put("hasSoulUsed",     p.hasSoulUsed);
            map.put("hasPowerUsed",    p.hasPowerUsed);
            map.put("hasTimeUsed",     p.hasTimeUsed);
            map.put("hasRealityUsed",  p.hasRealityUsed);
            map.put("hasMindUsed",     p.hasMindUsed);

            // Historique des parties
            List<Map<String, Object>> notes = new ArrayList<>();
            if (p.notes != null) {
                for (GameNote note : p.notes) {
                    Map<String, Object> n = new HashMap<>();
                    n.put("name", note.name);
                    n.put("winningCamp", note.winningCamp != null
                            ? new HashMap<String, String>() {{ put("name", note.winningCamp.getName()); }}
                            : null);
                    n.put("winners", note.winners);
                    notes.add(n);
                }
            }
            map.put("notes", notes);

            // Rôle forcé si applicable
            if (p.settedRole != null) {
                map.put("settedRole", p.settedRole.getName());
            }

            list.add(map);
        }

        Map<String, Object> payload = new HashMap<>();
        payload.put("players", list);
        return GSON.toJson(payload);
    }

    /**
     * Envoie le JSON au backend via HTTP POST.
     * Retourne le code HTTP de la réponse.
     */
    private int postToSite(String jsonPayload) throws IOException {
        URL url = new URL(SITE_URL + "/api/ingest");
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
        conn.setRequestProperty("x-admin-key", ADMIN_KEY);
        conn.setDoOutput(true);
        conn.setConnectTimeout(5000);
        conn.setReadTimeout(10000);

        byte[] body = jsonPayload.getBytes(StandardCharsets.UTF_8);
        conn.setRequestProperty("Content-Length", String.valueOf(body.length));

        try (OutputStream os = conn.getOutputStream()) {
            os.write(body);
            os.flush();
        }

        int status = conn.getResponseCode();
        conn.disconnect();
        return status;
    }
}

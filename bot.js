const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, downloadMediaMessage } = require('@whiskeysockets/baileys');
const fs = require('fs');
const P = require('pino');
const { Boom } = require('@hapi/boom');
const moment = require("moment");
const mongoose = require("mongoose");
moment.locale('id');

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version, isLatest } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({ 
        auth: state,
        printQRInTerminal: true,
        logger: P({ level: 'silent' }) 
    });
    
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
        if (connection === 'close') {
            let reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            if (reason === 401) {
                console.log('Auth Expired, Restarting...');
                setTimeout(() => startBot(), 5000);
            } else {
                console.log('Reconnecting...');
                setTimeout(() => startBot(), 5000);
            }
        } else if (connection === 'open') {
            console.log('Bot Connected!');
        }
    });

    let dbPath = 'database.json';
    let db = { apps: {}, payment: "", list: [] };
    if (fs.existsSync(dbPath)) {
        try {
            let rawData = fs.readFileSync(dbPath, 'utf-8');
            db = JSON.parse(rawData);
            if (typeof db.apps !== 'object') db.apps = {};
            if (!Array.isArray(db.list)) db.list = [];
        } catch (error) {
            console.error("Error reading database.json, resetting database", error);
            db = { apps: {}, payment: "", list: [] };
        } 
    }

    function saveDatabase() {
        try {
            fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), "utf-8");
        } catch (error) {
            console.error("Error Saving database.json", error);
        }
    }

    sock.ev.on("messages.upsert", async (chatUpdate) => {
        if (!chatUpdate.messages || !chatUpdate.messages[0]) return;
        let m = chatUpdate.messages[0]; // ✅ Ambil pesan pertama
        if (!m.message || m.key.fromMe) return;
        const sender = m.key.remoteJid;
        const text = m.message.conversation || m.message.extendedTextMessage?.text || "";
        
        let groupMetadata;
        if (sender.endsWith('@g.us')) {
            groupMetadata = await sock.groupMetadata(sender);
        }

        let groupAdmins = [];
        if (groupMetadata) {
            groupAdmins = groupMetadata.participants.filter(p => p.admin).map(p => p.id);
        }

        const senderID = m.key.participant || sender; 
        const isAdmin = groupAdmins.includes(senderID);

        // Fitur Perintah Menu
        if (text.toLowerCase() === 'menu') {
            await sock.sendMessage(sender, { text: `\n🌟 *ＭＥＮＵ ＭＥＭＢＥＲ* 🌟\n\n
📌 *Daftar Perintah:*
1️⃣ list - Menampilkan daftar aplikasi.
2️⃣ Ketik nama aplikasi - Lihat deskripsi.
3️⃣ payment - Lihat info pembayaran.
4️⃣ owner - Lihat info pemilik.\n\n
🔥 *Gunakan perintah dengan bijak!*` });
        }

        // Fitur Perintah Menuadmin
        if (text.toLowerCase() === 'menuadmin' && isAdmin) {
            await sock.sendMessage(sender, { text: `\n👑 *ＭＥＮＵ ＡＤＭＩＮ* 👑\n\n
🛠️ *Daftar Perintah:*
1️⃣ tambahlist <nama> - Tambahkan aplikasi ke daftar.
2️⃣ tambahdesc <nama> <deskripsi> - Tambah deskripsi aplikasi.
3️⃣ hapus <nama> - Hapus aplikasi dari daftar.
4️⃣ .h <pesan> - Kirim pesan sebagai bot.
5️⃣ .b (reply pesan) - Update informasi pembayaran.
6️⃣ .kick @tag - Keluarkan member dari grup.
7️⃣ buka - Buka grup.
8️⃣ tutup - Tutup grup.
9️⃣ .p (reply pesan) - Pin pesan dalam grup.
🔟 ubahdesc (reply pesan) - Ubah deskripsi grup.
1️⃣1️⃣ proses (reply pesan) - Tandai pesanan sebagai diproses.
1️⃣2️⃣ done (reply pesan) - Tandai pesanan sebagai selesai.
1️⃣3️⃣ .ubahformat (reply pesan) - Ubah format akun aplikasi.` });
        }
        
        // FItur Peintah Tambahlist
        if (text.toLowerCase().startsWith("tambahlist") && isAdmin) {
            let item = text.split(" ").slice(1).join(" ").trim();

            if (!item) {
                await sock.sendMessage(sender, { text: "❌ Mohon masukkan nama aplikasi!" });
                return;
            }

            // ✅ Pastikan `db.apps` berbentuk object sebelum digunakan
            if (typeof db.apps !== "object") {
                db.apps = {};
            }

            // ✅ Cek apakah aplikasi sudah ada dalam daftar
            if (Object.keys(db.apps).some(app => app.toLowerCase() === item.toLowerCase())) {
                await sock.sendMessage(sender, { text: `⚠️ Aplikasi *${item}* sudah ada dalam daftar.` });
                return;
            }

            // ✅ Tambahkan aplikasi ke database
            db.apps[item] = "Deskripsi berhasil disimpan ✅";
            db.list.push(item);
            saveDatabase();
            await sock.sendMessage(sender, { text: `✅ Aplikasi *${item}* berhasil ditambahkan ke daftar.` });
            return;
        }

        if (text.toLowerCase().startsWith("ubahlist") && isAdmin) {
            let newList = text.split("\n").slice(1).map(item => item.trim()).filter(item => item);
            
            if (newList.length === 0) {
                return await sock.sendMessage(sender, { text: "❌ Mohon masukkan daftar aplikasi yang baru!" });
            }
            
            db.apps = {}; 
            db.list = newList;
            newList.forEach(app => db.apps[app] = "Stok Aplikasi Sedang Kosong ❗.");
            saveDatabase();
            
            await sock.sendMessage(sender, { text: "✅ Daftar aplikasi telah diperbarui!" });
        }

        //Fitur Perintah Hapus
        if (text.toLowerCase().startsWith('hapus') && isAdmin) {
            const nama = text.substring(6).trim();
            
            if (!nama) {
                return await sock.sendMessage(sender, { text: "❌ Mohon masukkan nama aplikasi yang ingin dihapus." });
            }

            let appKey = Object.keys(db.apps).find(key => key.toLowerCase().replace(/\s+/g, ' ').trim() === nama.toLowerCase().replace(/\s+/g, ' ').trim());

            if (appKey) {
                delete db.apps[appKey];
                db.list = db.list.filter(item => item.toLowerCase() !== appKey.toLowerCase());
                saveDatabase();
                await sock.sendMessage(sender, { text: `✅ *${appKey}* berhasil dihapus dari list.` });
            } else {
                await sock.sendMessage(sender, { text: `❌ *${nama}* tidak ditemukan dalam daftar.` });
            }
        }
        
        //Fitur Perintah Tambahdesc
        if (text.toLowerCase().startsWith("tambahdesc") && isAdmin) {
            let namaAplikasi;
            let deskripsi;

            let quotedMessage = m.message.extendedTextMessage?.contextInfo?.quotedMessage;

            if (quotedMessage) {
                if (quotedMessage.conversation) {
                    deskripsi = quotedMessage.conversation.trim();
                } else if (quotedMessage.imageMessage && quotedMessage.imageMessage.caption) {
                    deskripsi = quotedMessage.imageMessage.caption.trim();
                } else if (quotedMessage.extendedTextMessage?.text) {
                    deskripsi = quotedMessage.extendedTextMessage.text.trim();
                }
                namaAplikasi = text.split(" ").slice(1).join(" ").trim();
            } else {
                let args = text.split(" ");
                namaAplikasi = args[1]?.toLowerCase();
                deskripsi = args.slice(2).join(" ").trim();
            }

            if (!namaAplikasi || !deskripsi) {
                await sock.sendMessage(sender, { text: `❌ Format salah!\n\nGunakan salah satu cara berikut:\n1️⃣ *tambahdesc <nama_aplikasi> <deskripsi>*\n2️⃣ Reply pesan berisi deskripsi, lalu ketik *tambahdesc <nama_aplikasi>*` });
                return;
            }

            if (typeof db.apps !== "object") {
                db.apps = {};
            }

            let appKey = Object.keys(db.apps).find(key => key.toLowerCase().trim() === namaAplikasi.toLowerCase().trim());

            if (!appKey) {
                await sock.sendMessage(sender, { text: `❌ Aplikasi *${namaAplikasi}* tidak ditemukan dalam daftar.` });
                return;
            }

            db.apps[appKey] = deskripsi;
            saveDatabase();

            await sock.sendMessage(sender, { text: `✅ Deskripsi untuk *${appKey}* telah diperbarui.` });
        }

        //Fitur Perintah ubahdesc
        if (text.toLowerCase() === "ubahdesc" && isAdmin) {
            // Cek apakah pengguna mereply pesan
            if (!m.message.extendedTextMessage || !m.message.extendedTextMessage.contextInfo || !m.message.extendedTextMessage.contextInfo.quotedMessage) {
                await sock.sendMessage(sender, { text: "❌ Harap reply pesan yang berisi deskripsi baru untuk grup." });
                return;
            }

            // Ambil teks dari pesan yang di-reply
            let quotedMsg = m.message.extendedTextMessage.contextInfo.quotedMessage;
            let newDescription = quotedMsg.conversation || quotedMsg.extendedTextMessage?.text || quotedMsg.imageMessage?.caption || "";

            // Jika tidak ada teks deskripsi baru, batalkan
            if (!newDescription) {
                await sock.sendMessage(sender, { text: "❌ Harap reply pesan dengan teks untuk dijadikan deskripsi grup." });
                return;
            }

            // Pastikan bot adalah admin grup sebelum mengubah deskripsi
            let groupMetadata = await sock.groupMetadata(sender);
            let botNumber = sock.user.id.split(":")[0] + "@s.whatsapp.net"; // Pastikan format benar
            let isBotAdmin = groupMetadata.participants.some(p => p.id === botNumber && (p.admin === "admin" || p.admin === "superadmin"));

            if (!isBotAdmin) {
                await sock.sendMessage(sender, { text: "❌ Saya bukan admin grup, tidak bisa mengubah deskripsi." });
                return;
            }

            // Perbarui deskripsi grup
            try {
                await sock.groupUpdateDescription(sender, newDescription);
                await sock.sendMessage(sender, { text: `✅ Deskripsi grup telah diperbarui:\n\n${newDescription}` });
            } catch (error) {
                console.error("Gagal mengubah deskripsi grup:", error);
                await sock.sendMessage(sender, { text: "❌ Gagal mengubah deskripsi grup. Pastikan saya adalah admin." });
            }
        }

        //Fitur Perintah .ubahformat
        if (text.toLowerCase().startsWith(".ubahformat") && isAdmin) {
            if (!m.message.extendedTextMessage || !m.message.extendedTextMessage.contextInfo || !m.message.extendedTextMessage.contextInfo.quotedMessage) {
                await sock.sendMessage(sender, { text: "❌ Harap reply pesan yang berisi format acak yang ingin diubah." }, { quoted: m });
                return;
            }

            let quotedMsg = m.message.extendedTextMessage.contextInfo.quotedMessage;
            let quotedText = quotedMsg.conversation || quotedMsg.extendedTextMessage?.text || quotedMsg.imageMessage?.caption || "";

            // ✅ Logging untuk melihat isi pesan sebelum parsing
            console.log("===== RAW QUOTED TEXT =====");
            console.log(quotedText);
            console.log("===========================");

            // ✅ Bersihkan teks dari karakter tersembunyi
            quotedText = quotedText.replace(/\r/g, "").trim();

            // ✅ Regex yang diperbaiki
            let emailMatch = quotedText.match(/(?:Email|E-Mail|Mail)[\s:]+([\w\.-]+@[\w\.-]+\.\w+)/i);
            let passwordMatch = quotedText.match(/(?:🔑\s*Password|Password|Pass|Pwd)[\s:]+([^\n]+)/);
            let profilePinMatch = quotedText.match(/(?:PROFILE & PIN|Profil & Pin)[\s\S]*?\n([\w\s]+):\s*(\d+)/i);

            let email = emailMatch ? emailMatch[1].trim() : "Tidak ditemukan";
            let password = passwordMatch ? passwordMatch[1].trim() : "Tidak ditemukan";
            let profile = profilePinMatch ? profilePinMatch[1].trim() : "Tidak ditemukan";
            let pin = profilePinMatch ? profilePinMatch[2].trim() : "Tidak ditemukan";

            // ✅ Debugging hasil parsing
            console.log("===== PARSED DATA =====");
            console.log("Email:", email);
            console.log("Password:", password);
            console.log("Profile:", profile);
            console.log("PIN:", pin);
            console.log("===========================")
            
            if (profilePinMatch) {
                profile = profilePinMatch[1].trim(); // Misal: "KOALA 2"
                pin = profilePinMatch[2].trim(); // Misal: "0002"
            }

            // Debugging: Lihat hasil parsing
            console.log("Parsed Data:", { email, password, profile, pin });

            if (email === "Tidak ditemukan" || password === "Tidak ditemukan" || profile === "Tidak ditemukan" || pin === "Tidak ditemukan") {
                await sock.sendMessage(sender, { text: "❌ Format tidak dikenali. Pastikan pesan memiliki Email, Password, dan Profil/PIN!" }, { quoted: m });
                return;
            }

            // Perintah ubah format seperti biasa
            const args = text.split(" ");
            if (args.length < 3) {
                await sock.sendMessage(sender, { text: "❌ Format salah! Gunakan `.ubahformat <nama_aplikasi> <durasi>`\nContoh: `.ubahformat netflix 14hari`" }, { quoted: m });
                return;
            }

            let appName = args[1].toLowerCase();
            let durationText = args.slice(2).join(" ").toLowerCase();

            // Hitung durasi
            let endDate = moment();
            if (durationText.includes("tahun")) {
                let years = parseInt(durationText.replace(/\D/g, "")) || 1;
                endDate = moment().add(years, "years");
            } else if (durationText.includes("bulan")) {
                let months = parseInt(durationText.replace(/\D/g, "")) || 1;
                endDate = moment().add(months, "months");
            } else if (durationText.includes("hari")) {
                let days = parseInt(durationText.replace(/\D/g, "")) || 7;
                endDate = moment().add(days, "days");
            }

            let purchaseDate = moment().format("DD MMMM YYYY");
            let formattedEndDate = endDate.format("DD MMMM YYYY");

            const appFormats = {
                netflixs: `NETFLIX SHARED ${durationText.toUpperCase()} @rendzal
========================================

📧 *Email:* ${email}
🔑 *Password:* ${password}
👤 *Profil:* ${profile}
🔢 *PIN:* ${pin}

📅 *Pembelian:* ${purchaseDate}
📆 *Berakhir:* ${endDate.format("DD MMMM YYYY")}

============= SYARAT & KETENTUAN =============
*- 1 Profile = 1 Device*
*- Dilarang mengganti email / password akun.*
*- Dilarang otak-atik akun*
*- Dilarang menggunakan VPN*
*- Garansi paling lambat 2x24 jam*

============== UNTITLED STORE ==============`,

                netflixp: `NETFLIX PRIVATED ${durationText.toUpperCase()} @rendzal
========================================

📧 *Email:* ${email}
🔑 *Password:* ${password}
👤 *Profil:* ${profile}
🔢 *PIN:* ${pin}

📅 *Pembelian:* ${purchaseDate}
📆 *Berakhir:* ${endDate.format("DD MMMM YYYY")}

============= SYARAT & KETENTUAN =============
*- 1 Profile = 1 Device*
*- Dilarang mengganti email / password akun.*
*- Dilarang otak-atik akun*
*- Dilarang menggunakan VPN*
*- Garansi paling lambat 2x24 jam*

============== UNTITLED STORE ==============`,

                spotify: `SPOTIFY FAMILY ${durationText.toUpperCase()} @rendzal
========================================

📧 *Email:* ${email}
🔑 *Password:* ${password}

📅 *Pembelian:* ${purchaseDate}
📆 *Berakhir:* ${endDate.format("DD MMMM YYYY")}

=============SYARAT & KETENTUAN =============
*- Hanya untuk 1 perangkat*
*- Tidak boleh keluar dari grup family*
*- Tidak boleh mengganti password*
*- Garansi 3 bulan selama tetap dalam grup*

============== UNTITLED STORE ==============`
            };

            if (!(appName in appFormats)) {
                let availableApps = Object.keys(appFormats).join(", ");
                await sock.sendMessage(sender, { text: `❌ Aplikasi *${appName}* tidak tersedia.\nGunakan aplikasi yang didukung: ${availableApps}.` }, { quoted: m });
                return;
            }

            let formattedMessage = appFormats[appName]
                .replace("${email}", email)
                .replace("${password}", password)
                .replace("${profile}", profile)
                .replace("${pin}", pin)
                .replace("${purchaseDate}", purchaseDate)
                .replace("${endDate}", formattedEndDate)
                .replace("${user}", `@${m.key.participant.split("@")[0]}`);

            await sock.sendMessage(sender, { text: formattedMessage, mentions: [m.key.participant] }, { quoted: m });
        }
        
        //Fitur Peintah List
        if (text.toLowerCase() === 'list') {
            // Pastikan `db.apps` adalah objek
            if (typeof db.apps !== 'object' || Object.keys(db.apps).length === 0) {
                await sock.sendMessage(sender, { text: `📌 Daftar aplikasi kosong.\nGunakan *tambahlist <nama_aplikasi>* untuk menambahkan.` });
                return;
            }

            // Ambil semua nama aplikasi yang ada di `db.apps`
            let orderUser = m.key.participant || sender;
            let now = new Date();
            let tanggal = now.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });
            let waktu = now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Jakarta" });
            let daftarAplikasi = Object.keys(db.apps).map((app, index) => `*${index + 1}. ${app}*`).join('\n');

            saveDatabase();
            await sock.sendMessage(sender, { 
                text: `Hai @${orderUser.split("@")[0]} 👋\n\n *── .Tanggal : ${tanggal}*\n *── .Waktu : ${waktu}*\n\n ╭─✧ [ 📜 *DAFTAR APLIKASI PREMIUM* ] ✧─╮\n\n${daftarAplikasi}\n\n-Untuk melihat detail Aplikasi dan harga, silahkan ketik nama produk yang ada pada list di atas.\n-Jika ingin melihat perintah lain silahkan ketik "menu"\n-Jika ingin melakukan pemesanan silahkan contact owner atau admin yang aktif!.\n ╰────✧ [ *HAVE A GOOD DAY* 😇 ] ✧────╯`,
                mentions: [orderUser]
            });
        }

        // Fitur Perintah Owner
        if (text.toLowerCase() === "owner") {
            let ownerNumber = "62895379089030@s.whatsapp.net"; // Ganti dengan nomor owner dalam format internasional

            let ownerProfile = `👑 *Owner Grup* 👑\n\n`;
            ownerProfile += `📌 Nama: RENDY ZALSAHRA\n`;
            ownerProfile += `📞 Nomor: wa.me/${ownerNumber.replace("@s.whatsapp.net", "")}\n`;
            ownerProfile += `🔹 Nomer owner hanya ini. selain nomer diatas itu bukan owner! Stay Safe All.\n`;

            await sock.sendMessage(sender, { text: ownerProfile });
        }

        // Fitur Perintah Payment
        if (text.toLowerCase().startsWith("payment")) {
            if (!db.payment && !db.paymentImage) {
                await sock.sendMessage(sender, { text: "❌ Informasi pembayaran belum tersedia." });
                return;
            }

            if (db.paymentImage) {
                await sock.sendMessage(sender, {
                    image: fs.readFileSync(db.paymentImage),
                    caption: `💰 *Informasi Pembayaran:*\n\n${db.payment || "QRIS tersedia tanpa teks."}`
                });
            } else {
                await sock.sendMessage(sender, { text: `💰 *Informasi Pembayaran:*\n\n${db.payment}` });
            }
        }

        // Fitur Perintah .h Broadcast
        if (text.toLowerCase().startsWith('.h ') && isAdmin) {
            const pesan = text.slice(3);
            await sock.sendMessage(sender, { text: `${pesan}` });
        }
        
        // Fitur Perintah .b ubah payment
        if (text.toLowerCase() === '.b' && isAdmin) {
            if (!m.message.extendedTextMessage || !m.message.extendedTextMessage.contextInfo || !m.message.extendedTextMessage.contextInfo.quotedMessage) {
                await sock.sendMessage(sender, { text: `❌ Harap reply pesan yang berisi informasi pembayaran (teks atau gambar QRIS).` });
                return;
            }

            const quotedMsg = m.message.extendedTextMessage.contextInfo.quotedMessage;

            if (quotedMsg.conversation) {
                // Jika yang di-reply adalah teks
                db.payment = quotedMsg.conversation;
                fs.writeFileSync('database.json', JSON.stringify(db, null, 2), 'utf-8');
                await sock.sendMessage(sender, { text: `✅ Info pembayaran diperbarui:\n\n${db.payment}` });
            } else if (quotedMsg.imageMessage) {
                // Jika yang di-reply adalah gambar (QRIS)
                const mediaMessage = {
                    key: m.message.extendedTextMessage.contextInfo.stanzaId,
                    message: quotedMsg
                };

                const buffer = await downloadMediaMessage(mediaMessage, "buffer");
                const imagePath = "payment_qris.jpg";
                fs.writeFileSync(imagePath, buffer);

                // Simpan path gambar ke database
                db.paymentImage = imagePath;

                // Cek apakah ada caption di gambar
            if (quotedMsg.imageMessage.caption) {
                    db.payment = quotedMsg.imageMessage.caption;
                    fs.writeFileSync('database.json', JSON.stringify(db, null, 2), 'utf-8');
                }

                saveDatabase();
                await sock.sendMessage(sender, { text: `✅ Gambar QRIS ${quotedMsg.imageMessage.caption ? "dan teks" : ""} telah diperbarui.` });
            } else {
                await sock.sendMessage(sender, { text: `❌ Hanya bisa memperbarui teks atau gambar QRIS.` });
            }
        }

        // Fitur Perintah .p Pin pesan
        if (text.toLowerCase() === ".p" && sender.endsWith("@g.us") && isAdmin) {
            if (!m.message.extendedTextMessage || !m.message.extendedTextMessage.contextInfo || !m.message.extendedTextMessage.contextInfo.quotedMessage) {
                await sock.sendMessage(sender, { text: "❌ Harap reply pesan yang ingin dipin di grup." });
                return;
            }

            let quotedMsg = m.message.extendedTextMessage.contextInfo.quotedMessage;
            let pinnedText = quotedMsg.conversation || quotedMsg.extendedTextMessage?.text || quotedMsg.imageMessage?.caption || "";

            if (!pinnedText) {
                await sock.sendMessage(sender, { text: "❌ Pesan tidak valid. Pastikan Anda mereply teks atau gambar dengan caption." });
                return;
            }

            let stanzaId = m.message.extendedTextMessage.contextInfo.stanzaId; // ID unik pesan yang akan dipin
            let pinnedUser = m.message.extendedTextMessage.contextInfo.participant;
            let pinnedMsg = `📌 *Pesan Dipin di Grup* 📌\n\n📜 *${pinnedText}*\n👤 Oleh: @${pinnedUser.split("@")[0]}`;

            // Kirim pesan pinned dengan quoting pesan asli
            await sock.sendMessage(sender, { 
                text: pinnedMsg, 
                mentions: [pinnedUser],
                quoted: { 
                    key: { remoteJid: sender, fromMe: false, id: stanzaId },
                    message: quotedMsg
                }
            });
        }

        // Fitur Perintah Proses
        if (text.toLowerCase() === "proses" && isAdmin) {
            if (!m.message.extendedTextMessage || !m.message.extendedTextMessage.contextInfo || !m.message.extendedTextMessage.contextInfo.quotedMessage) {
                await sock.sendMessage(sender, { text: "❌ Harap reply pesan pesanan yang ingin diproses." });
                return;
            }

            let quotedMsg = m.message.extendedTextMessage.contextInfo.quotedMessage;
            let orderText = quotedMsg.conversation || quotedMsg.extendedTextMessage?.text || quotedMsg.imageMessage?.caption || "";

            if (!orderText) {
                await sock.sendMessage(sender, { text: "❌ Pesanan tidak valid. Pastikan Anda mereply teks atau gambar dengan caption." });
                return;
            }

            let orderUser = m.message.extendedTextMessage.contextInfo.participant;
            let now = new Date();
            let tanggal = now.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });
            let waktu = now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Jakarta" });

            let processMsg = `⏳ *Pesanan Sedang Diproses* ⏳\n\n📅 Tanggal: ${tanggal}\n⏰ Waktu: ${waktu}\n📜 *${orderText}*\n👤 Status: *Sedang Diproses*\n🔖 Oleh: @${orderUser.split("@")[0]}`;

            await sock.sendMessage(sender, { text: processMsg, mentions: [orderUser] }, { quoted: m });
        }

        // Fitur Perintah Done
        if (text.toLowerCase() === "done" && isAdmin) {
            if (!m.message.extendedTextMessage || !m.message.extendedTextMessage.contextInfo || !m.message.extendedTextMessage.contextInfo.quotedMessage) {
                await sock.sendMessage(sender, { text: "❌ Harap reply pesan pesanan yang sedang diproses untuk menyelesaikannya." });
                return;
            }

            let quotedMsg = m.message.extendedTextMessage.contextInfo.quotedMessage;
            let orderText = quotedMsg.conversation || quotedMsg.extendedTextMessage?.text || quotedMsg.imageMessage?.caption || "";

            if (!orderText) {
                await sock.sendMessage(sender, { text: "❌ Pesanan tidak valid. Pastikan Anda mereply pesan yang benar." });
                return;
            }

            let orderUser = m.message.extendedTextMessage.contextInfo.participant;
            let now = new Date();
            let tanggal = now.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });
            let waktu = now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Jakarta" });

            let doneMsg = `✅ *Pesanan Selesai* ✅\n\n📅 Tanggal: ${tanggal}\n⏰ Waktu: ${waktu}\n📜 *${orderText}*\n👤 Status: *Selesai*\n🔖 Oleh: @${orderUser.split("@")[0]}`;

            await sock.sendMessage(sender, { text: doneMsg, mentions: [orderUser] }, { quoted: m });
        }

        // Fitur Perintah .kick
        if (text.toLowerCase().startsWith('.kick ') && isAdmin) {
            const mentioned = m.message.extendedTextMessage?.contextInfo?.mentionedJid;
            if (mentioned) {
                for (let user of mentioned) {
                    await sock.groupParticipantsUpdate(sender, [user], 'remove');
                }
                await sock.sendMessage(sender, { text: `✅ Member dikeluarkan.` });
            }
        }
        
        // Fitur Perintah buka
        if (text.toLowerCase() === 'buka' && isAdmin) {
            await sock.groupSettingUpdate(sender, 'not_announcement');
            await sock.sendMessage(sender, { text: '✅ Grup telah dibuka.' });
        }
        
        // Fitur Perintah Tutup
        if (text.toLowerCase() === 'tutup' && isAdmin) {
            await sock.groupSettingUpdate(sender, 'announcement');
            await sock.sendMessage(sender, { text: '✅ Grup telah ditutup.' });
        }

        if (Object.keys(db.apps).some(app => app.toLowerCase() === text.toLowerCase())) {
            let namaAplikasi = Object.keys(db.apps).find(app => app.toLowerCase() === text.toLowerCase());
            let deskripsi = db.apps[namaAplikasi];

            await sock.sendMessage(sender, { text: `\n${deskripsi}` });
        }

    });

    sock.ev.on("group-participants.update", async (update) => {
        try {
            let groupMetadata = await sock.groupMetadata(update.id);
            let groupName = groupMetadata.subject;
            
            // Jika ada member yang baru masuk
            if (update.action === "add") {
                for (let participant of update.participants) {
                    let userTag = `@${participant.split("@")[0]}`;

                    let welcomeText = `🎉 「 SELAMAT DATANG DAN SELAMAT BERGABUNG DI *${groupName}*」 ${userTag} 🎉!\n\n- 📓 Silahkan ketik "menu" untuk melihat perintah\n- 📋 Untuk melihat list aplikasi yang tersedia silahkan ketik "list"\n- 🔍 Dan untuk melihat detail aplikasi silahkan ketik nama aplikasi nya.\n\n「 HAVE A NICE DAY ALL😇 」`;
                    
                    await sock.sendMessage(update.id, { text: welcomeText, mentions: [participant] });
                }
            }
            
            // Jika ada member yang keluar
            if (update.action === "remove") {
                for (let participant of update.participants) {
                    let userTag = `@${participant.split("@")[0]}`;
                    
                    let goodbyeText = `👋 ${userTag} telah keluar dari grup *${groupName}*. Semoga sukses di luar sana! 🚀`;
                    
                    await sock.sendMessage(update.id, { text: goodbyeText, mentions: [participant] });
                }
            }
        } catch (error) {
            console.error("❌ Error saat mengirim pesan selamat datang/keluar:", error);
        }
    });

}
startBot();
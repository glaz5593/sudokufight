import type { TelemetryEventName } from '@sudoku-fight/protocol';

import type { LegalChrome } from '../render';
import type { LegalDoc, LegalDocId } from '../types';

/**
 * The legal pages in Indonesian (D112): a translation of the English version (privacy.ts, terms.ts,
 * deleteAccount.ts, render.ts LEGAL_CHROME.en), with the same sections, anchors, links, marks, contact
 * placeholders and numbers (legal.test.ts `skeleton`). kamu, never Anda (docs/i18n/style/id.md); terms from
 * docs/i18n/glossary.csv (pertandingan, lawan, rating, ranked, room, laporan, blokir, gangguan, reaksi, tahap,
 * replay, latihan, papan, bintang, bab, level, XP). The page opens with TRANSLATION_NOTICE_ID: the English
 * version prevails.
 *
 * App labels quoted here (they must equal the app's id strings): Pengaturan (home:settings.title), Hapus akun
 * (account:settings.deleteAccount), Pemain yang diblokir (moderation:blocked.settingsRow), Lisensi
 * (home:settings.licenses), “Lawan terakhirmu” (progress:leaderboard.caption.friends), “Cara bermain”
 * (levels:tutorial.title); the report reasons nama yang menyinggung, curang, lainnya
 * (moderation:report.reasons.offensiveName, .cheating, .other), written in lower case inside sentences.
 *
 * Word choices: "game" is the app and its service, "pertandingan" one game played on a board (glossary); a
 * puzzle is "teka-teki"; staged practice is "latihan bertahap"; an account's suspension is "penangguhan" /
 * "menangguhkan"; "fair play" stays in English, as Indonesian players say it. "gangguan" is only the
 * interference, so other disruptions are worded without it ("tanpa terputus", "mengacaukan").
 */

/** "This is a translation of the English version. If they differ, the English version prevails." */
export const TRANSLATION_NOTICE_ID =
  'Ini adalah terjemahan dari versi bahasa Inggris. Jika ada perbedaan, versi bahasa Inggris yang berlaku.';

/** The words around the texts (render.ts LegalChrome). */
export const LEGAL_CHROME_ID: LegalChrome = {
  brand: 'Sudoku Fight',
  languages: 'Bahasa',
  contents: 'Daftar isi',
  documents: 'Dokumen',
  updated: 'Terakhir diperbarui:',
  emailPlaceholder: 'privacy@<domain>',
  operatorPlaceholder: '[nama operator]',
  draft: 'Draf: detail kontak belum diatur di server (LEGAL_CONTACT_EMAIL, LEGAL_OPERATOR_NAME).',
  translationNotice: TRANSLATION_NOTICE_ID,
};

/** Each reported event and what it carries (privacy.ts EVENT_DETAILS, `id`): [what happens, what it carries]. */
export const EVENT_DETAILS_ID: Record<TelemetryEventName, [string, string]> = {
  app_open: ['Aplikasi dibuka', '—'],
  screen_view: ['Sebuah layar dibuka', 'Nama layar (pola rutenya, tanpa ID)'],
  register_step: ['Satu langkah pendaftaran dibuka', 'Langkahnya'],
  register_complete: ['Pendaftaran selesai', '—'],
  game_start: [
    'Pertandingan dimulai',
    'Mode, jenis permainan, jumlah pemain, dan apakah ini pertandingan dengan teman',
  ],
  game_end: [
    'Pertandingan berakhir',
    'Mode, hasil, skor, jumlah kesalahan, durasi, dan apakah itu pertandingan dengan teman',
  ],
  interference_sent: ['Kamu mengirim gangguan', 'Jenis dan biayanya'],
  reaction_sent: ['Kamu mengirim reaksi', 'Emoji yang mana'],
  matchmaking_wait: [
    'Pencarian lawan berakhir',
    'Lama menunggu dalam detik, dan apakah pertandingan ditemukan',
  ],
  reconnect: ['Menyambung kembali setelah koneksi terputus', 'Berapa lama waktunya, dan apakah berhasil'],
  latency_sample: ['Sampel kualitas koneksi', 'Waktu respons jaringan, dalam milidetik'],
  replay_open: ['Replay dibuka', 'Mode pertandingan'],
  account_delete: ['Akun dihapus', '—'],
  report_sent: [
    'Kamu melaporkan pemain',
    'Alasannya saja (bukan siapa yang dilaporkan, juga bukan pertandingannya)',
  ],
  level_map_open: ['Peta latihan bertahap dibuka', 'Tahap saat ini dan total bintangmu'],
  level_start: [
    'Tahap dimulai',
    'Nomor dan versi tahap, bab dan jenisnya, nomor percobaan, bintang terbaikmu sejauh ini, dan apakah ini mulai cepat',
  ],
  level_end: [
    'Tahap berakhir',
    'Nomor, versi, dan jenis tahap, bintangnya, bintang terbaikmu sebelumnya, durasinya, cara berakhirnya, jumlah kesalahan, hasilnya (waktu, tempat, keunggulan, atau poin), level bot, dan nomor percobaan',
  ],
  level_quit: [
    'Tahap ditinggalkan di tengah jalan (misalnya, aplikasi ditutup)',
    'Nomor dan versi tahap, dan berapa lama tahap itu sudah berjalan',
  ],
  chapter_gate: [
    'Percobaan melewati gerbang ke bab berikutnya',
    'Bab di balik gerbang, bintang di bab itu, dan apakah gerbangnya terbuka',
  ],
  level_tutorial: [
    '“Cara bermain” untuk satu jenis tahap ditampilkan',
    'Jenisnya, dan apakah kamu melewatkannya',
  ],
  friends_room_open: [
    'Room untuk bermain dengan teman dibuka',
    'Jenis permainan, dan bagaimana room itu dibuka',
  ],
  friends_room_join: [
    'Percobaan bergabung ke room teman',
    'Caranya (kode atau tautan), dan bagaimana hasilnya (berhasil, atau alasan gagalnya)',
  ],
  friends_invite_share: [
    'Tautan sebuah room dibagikan',
    'Apakah host atau tamu yang membagikannya (bukan kodenya, juga bukan kepada siapa)',
  ],
  friends_link_open: ['Tautan room membuka aplikasi', 'Apakah kamu sedang masuk ke akunmu'],
  friends_room_start: [
    'Pertandingan dengan teman dimulai',
    'Jumlah pemain, dan berapa detik kamu menunggu di room',
  ],
  friends_room_close: [
    'Kamu keluar dari room sebelum pertandingannya dimulai',
    'Alasannya, berapa pemain yang ada di room, dan berapa detik kamu menunggu',
  ],
};

const eventRows = () =>
  (Object.keys(EVENT_DETAILS_ID) as TelemetryEventName[]).map((name) => [
    `\`${name}\``,
    ...EVENT_DETAILS_ID[name],
  ]);

export const PRIVACY_ID: LegalDoc = {
  title: 'Kebijakan privasi',
  lead: 'Apa yang dikumpulkan Sudoku Fight, untuk apa, siapa yang melihatnya, berapa lama disimpan, dan cara menghapusnya.',
  sections: [
    {
      id: 'who',
      title: 'Siapa kami',
      blocks: [
        'Sudoku Fight (“game ini”, “kami”) adalah game sudoku kompetitif secara real-time yang dioperasikan oleh {operator}.',
        'Untuk pertanyaan apa pun tentang privasi dan datamu, kirim email kepada kami di {email}.',
      ],
    },
    {
      id: 'summary',
      title: 'Singkatnya',
      blocks: [
        {
          list: [
            'Kami hanya mengumpulkan apa yang dibutuhkan untuk menjalankan game: detail akunmu, pertandinganmu, dan data penggunaan yang membantu kami memahami cara game ini dimainkan dan memperbaiki masalah.',
            '**Tanpa iklan, dan kami tidak menjual data.** Kami tidak melacakmu di aplikasi atau situs web lain.',
            'Nama tampilan, avatar, negara, rating, dan statistikmu terlihat oleh pemain lain. Emailmu tidak pernah ditampilkan kepada pemain lain.',
            'Kamu bisa menghapus akunmu di aplikasi kapan saja: Pengaturan → Hapus akun. Lihat [halaman penghapusan akun](delete-account).',
          ],
        },
      ],
    },
    {
      id: 'account',
      title: 'Detail akun',
      blocks: [
        'Saat kamu mendaftar, kami menyimpan:',
        {
          list: [
            '**Email:** untuk masuk, memverifikasi alamat itu, mengatur ulang kata sandimu, dan mengirim pesan terkait akun. Kami tidak mengirim email pemasaran.',
            '**Kata sandi** (jika kamu mendaftar dengan email dan kata sandi): ditangani oleh Firebase Authentication milik Google. Kata sandi itu tidak pernah sampai ke server kami, dan kami tidak bisa melihatnya.',
            '**Masuk dengan Google (opsional):** kamu bisa mendaftar dan masuk dengan akun Google-mu sebagai pengganti email dan kata sandi. Firebase Authentication lalu menerima dari Google email akun Google-mu (yang sudah diverifikasi oleh Google) beserta ID Google-nya, dan menyimpannya bersama data login kamu; kami menyimpan email itu seperti pada akun lainnya. Google juga memberikan nama Google dan foto profilmu kepada Firebase, yang menyimpannya bersama data login itu. Server kami tidak menyimpan atau menampilkannya: di arena, hanya nama dan avatar yang kamu pilih yang muncul. Kami tidak pernah mendapatkan kata sandi Google-mu, atau akses ke hal lain apa pun di akun Google-mu (kontak, email, file). Jika kamu lebih suka, daftarlah dengan email dan kata sandi.',
            '**Nama tampilan, negara, dan avatar:** kamu yang memilihnya, dan semuanya ditampilkan kepada pemain lain. Kamu memilih negara sendiri (pilihan bawaannya berasal dari pengaturan bahasa dan wilayah perangkatmu). Kami tidak menggunakan lokasi perangkatmu.',
            '**Kapan akun dibuat dan kapan nama terakhir diubah** (nama bisa diubah sekali dalam 30 hari).',
            '**ID akun dari kami**, dan ID login Firebase kamu (jika kamu masuk dengan Google, Firebase juga menyimpan ID akun Google-mu).',
          ],
        },
      ],
    },
    {
      id: 'games',
      title: 'Pertandingan dan progres',
      blocks: [
        {
          list: [
            '**Pertandingan ranked** (disimpan di server): papan, setiap langkah beserta waktunya, gangguan dan reaksi yang kamu kirim, skormu, kesalahanmu, posisimu, ratingmu sebelum dan sesudahnya, dan bagaimana pertandingan itu berakhir. Semua ini membentuk riwayat, replay, dan statistikmu.',
            '**Pertandingan dengan teman** (di room dengan kode; disimpan di server seperti pertandingan ranked, tetapi tanpa rating): detail yang sama, kecuali rating. Pertandingan ini muncul di riwayat dan replay kamu, dan pemain yang pernah bermain denganmu muncul di “Lawan terakhirmu”. Kode room, siapa yang ada di room, dan siapa yang dikeluarkan darinya hanya disimpan di memori server, sampai room itu ditutup.',
            '**Rating, XP, level, dan pencapaian.**',
            '**Teka-teki mana yang kamu mainkan, dan melawan siapa:** agar kamu tidak mendapat teka-teki atau lawan yang sama berulang kali.',
            '**Tempo bermainmu:** di akhir setiap pertandingan ranked, kami menghitung dari langkah-langkahmu rata-rata waktumu per langkah (dengan memperhitungkan tingkat kesulitan setiap sel), lalu menyimpannya bersama pertandingan itu, beserta jumlah langkah yang menjadi dasar pengukurannya. Dari tempo itu, tingkat kesalahanmu, dan hasilmu melawan lawan yang dikendalikan komputer, kami mengatur tempo lawan yang dikendalikan komputer saat tidak ada pemain yang tersedia (lihat [ketentuan penggunaan](terms)). Tempo bermainmu tidak ditampilkan kepada pemain lain.',
            '**Hasil latihan** (sendiri atau melawan bot), saat aplikasi melaporkannya untuk XP: mode, jenis permainan, hasil, jumlah langkah yang benar, kapan latihan itu berakhir, dan XP yang didapat.',
            '**Latihan bertahap:** saat aplikasi menyinkronkan progresmu ke akunmu (agar progres itu kembali juga di ponsel baru): bintang terbaikmu di setiap tahap, berapa kali kamu memainkannya dan kapan itu berubah, serta XP yang diberikan tahap-tahap itu setiap hari.',
            '**Fair play:** saat tempo langkah dalam sebuah pertandingan ranked luar biasa cepat, sebuah catatan disimpan untuk ditinjau oleh seseorang. Tidak ada tindakan otomatis karena catatan itu.',
            '**Laporan dan blokir:** lihat “Laporan dan blokir” di bawah.',
          ],
        },
      ],
    },
    {
      id: 'usage',
      title: 'Data penggunaan',
      blocks: [
        'Untuk memahami cara game ini digunakan, aplikasi melaporkan peristiwa ke server kami. Setiap peristiwa punya ID acaknya sendiri dan waktu di ponselmu; server menambahkan waktu saat menerimanya.',
        'Setiap laporan juga membawa **ID instalasi**: angka acak yang dibuat saat aplikasi pertama kali dijalankan dan disimpan di aplikasi. ID ini tidak didasarkan pada detail perangkatmu, dan hilang saat kamu menghapus aplikasi. Bersamanya ikut terkirim sistem (iOS atau Android) dan versi aplikasi.',
        'Selama kamu masuk ke akunmu, peristiwa dan instalasi itu terhubung ke akunmu. Tanpa koneksi, peristiwa menunggu di ponselmu dan dikirim nanti.',
        'Peristiwanya:',
        { table: { head: ['Peristiwa', 'Kapan', 'Apa yang dibawanya'], rows: eventRows() } },
        'Peristiwa yang sama juga dikirim ke **Google Analytics for Firebase**, yang menambahkan ID instalasi aplikasi, detail perangkat dan sistem, data penggunaan (seperti durasi sesi), dan perkiraan lokasi (negara dan wilayah) yang disimpulkan Google dari alamat IP. Kami mengaturnya tanpa fitur periklanan: tanpa ID iklan, dan tanpa personalisasi iklan.',
      ],
    },
    {
      id: 'crashes',
      title: 'Laporan crash dan error',
      blocks: [
        {
          list: [
            '**Di aplikasi, Firebase Crashlytics milik Google:** saat aplikasi crash atau mengalami error, sebuah laporan dikirim berisi detail error, model perangkat, versi sistem dan aplikasi, ID instalasi Crashlytics, dan ID akun dari kami selama kamu masuk ke akunmu. Bukan email atau namamu.',
            '**Di server, Sentry:** saat server mengalami error, sebuah laporan teknis tentang error itu dikirim, terkadang beserta ID akun yang terlibat. Tanpa email dan tanpa kata sandi.',
          ],
        },
      ],
    },
    {
      id: 'ip',
      title: 'Alamat IP',
      blocks: [
        'Saat aplikasi terhubung, server kami melihat alamat IP-mu. Kami menggunakannya **hanya di memori server**, untuk membatasi laju permintaan dan melindungi dari banjir permintaan, dan kami tidak menyimpannya di basis data kami.',
        'Penyedia hosting kami mungkin menyimpan log akses biasa untuk waktu yang singkat.',
      ],
    },
    {
      id: 'device',
      title: 'Yang hanya tersimpan di ponselmu',
      blocks: [
        {
          list: [
            'Pertandingan latihanmu dan riwayatnya.',
            'Progres latihan bertahapmu: bintang, percobaan, dan gerbang yang sudah kamu buka (salinannya juga disimpan di server: lihat “Pertandingan dan progres”).',
            'Pengaturanmu: suara, getaran, pengurangan gerakan, dan bahasa.',
            'Salinan profilmu, agar aplikasi bisa dibuka tanpa koneksi.',
            'Antrean peristiwa dan hasil latihan yang belum terkirim, serta ID instalasi.',
            'Data login kamu (disimpan oleh Firebase), dan jika kamu masuk dengan Google, akun yang kamu pilih (disimpan oleh layanan Google Play sampai kamu keluar).',
          ],
        },
        'Semua ini dihapus saat kamu menghapus aplikasi. Keluar dari akun menghapus salinan profil. Menghapus akunmu tidak menghapus pertandingan latihan dan progres latihan bertahap di ponselmu: untuk menghapus semua itu juga, hapus aplikasinya.',
      ],
    },
    {
      id: 'not-collected',
      title: 'Yang tidak kami kumpulkan',
      blocks: [
        'Kontak, foto, mikrofon, kamera, lokasi akurat, ID iklan, dan detail pembayaran. Game ini tidak punya chat: reaksi adalah emoji dari daftar yang tetap.',
      ],
    },
    {
      id: 'public',
      title: 'Yang dilihat pemain lain',
      blocks: [
        {
          list: [
            'Nama tampilan, avatar, negara (sebagai bendera), rating, level, dan pencapaianmu.',
            'Di kartu pemainmu dan papan peringkat: jumlah pertandingan, persentase kemenangan, kemenangan beruntun, langkah terbaik, rata-rata kesalahan, hasil terbaru, gangguan yang paling sering kamu kirim, dan kapan kamu bergabung (bulan dan tahun).',
            'Selama pertandingan: skor, kesalahan, gangguan, dan reaksimu, serta apakah kamu sedang online.',
            'Di room untuk bermain dengan teman: siapa pun yang punya kode atau tautannya dan masuk ke room itu bisa melihat nama, avatar, bendera, dan rating umum semua orang di dalamnya, serta apakah mereka sedang berada di room saat itu. Kode dan tautan itu sendiri tidak membawa informasi pribadi apa pun.',
            'Replay dan detail pertandingan: hanya para pemain pertandingan itu.',
          ],
        },
      ],
    },
    {
      id: 'reports',
      title: 'Laporan dan blokir',
      blocks: [
        {
          list: [
            '**Melaporkan pemain:** saat kamu melaporkan seseorang, kami menyimpan siapa yang melapor, siapa yang dilaporkan, alasannya (nama yang menyinggung, curang, atau lainnya), pertandingan ranked jika laporan itu berasal dari sebuah pertandingan ranked, dan kapan. Laporan tidak berisi teks bebas. Pemain yang dilaporkan tidak diberi tahu siapa yang melaporkannya.',
            '**Memblokir:** kami menyimpan pemain yang kamu blokir dan kapan. Karena blokir itu, kamu tidak ditempatkan di pertandingan yang sama dengan mereka, dan reaksi mereka tidak ditampilkan kepadamu. Tidak ada yang diberi tahu bahwa mereka diblokir, dan blokir tidak menyembunyikan siapa pun dari papan peringkat.',
            '**Penanganan laporan:** operator game meninjau setiap laporan dalam 48 jam. Operator dapat mengganti nama yang menyinggung dengan nama sementara (pemain itu lalu diminta memilih nama baru), atau menangguhkan akun dari pertandingan ranked dan perubahan akun. Setiap tindakan seperti itu dicatat dalam log internal, beserta alamat admin yang melakukannya, serta nama lama dan baru jika sebuah nama diganti. Nama yang diganti dengan cara ini masuk ke daftar nama yang tidak boleh dipilih lagi oleh siapa pun (hanya namanya, tidak terhubung ke pemain mana pun).',
            '**Akun yang ditangguhkan lalu dihapus:** menghapus akun tidak mencabut penangguhan. Saat akun yang ditangguhkan dihapus, kami menyimpan sidik jari satu arah (hash) dari ID login akun itu dan dari alamat email terverifikasinya, bukan ID atau alamat itu sendiri. Akun baru dengan login yang sama dimulai dalam keadaan ditangguhkan sampai admin meninjaunya, lalu sidik jari itu dihapus. Ini adalah kepentingan sah kami, dan kepentingan setiap pemain, atas fair play.',
          ],
        },
      ],
    },
    {
      id: 'use',
      title: 'Untuk apa kami menggunakan data',
      blocks: [
        {
          list: [
            '**Untuk menjalankan game:** akunmu, pertandingan, rating, pencarian lawan, riwayat, dan papan peringkat. Ini diperlukan untuk perjanjian kami denganmu (ketentuan penggunaan).',
            '**Keamanan dan fair play:** pembatasan laju permintaan, mendeteksi anomali, mencegah kecurangan, serta menangani laporan dan blokir. Ini adalah kepentingan sah kami, dan kepentingan setiap pemain.',
            '**Untuk meningkatkan game:** untuk mengetahui layar dan mode mana yang dimainkan, menemukan masalah, dan memperbaiki crash. Ini juga kepentingan yang sah, tanpa iklan dan tanpa profil pemasaran.',
            '**Email layanan:** hanya untuk verifikasi alamat dan pengaturan ulang kata sandi.',
          ],
        },
      ],
    },
    {
      id: 'sharing',
      title: 'Dengan siapa kami membagikannya',
      blocks: [
        'Kami **tidak menjual** data, dan kami tidak meneruskannya kepada pengiklan atau pialang data. Penyedia layanan kami memprosesnya hanya untuk kami:',
        {
          list: [
            '**Google (Firebase):** login (Authentication, termasuk masuk dengan Google), laporan crash (Crashlytics), dan data penggunaan (Analytics).',
            '**Fly.io:** hosting untuk server.',
            '**Neon:** basis data (PostgreSQL).',
            '**Sentry:** laporan error server.',
          ],
        },
        'Kami juga akan mengungkapkan data jika diwajibkan oleh hukum, atau untuk melindungi game dan para pemainnya. Jika game ini beralih ke pemilik lain, data ikut beralih bersamanya, dan kebijakan ini tetap berlaku untuk data tersebut.',
      ],
    },
    {
      id: 'transfers',
      title: 'Di mana data berada',
      blocks: [
        'Server dan basis data saat ini berada di Uni Eropa (Frankfurt, Jerman). Google dan Sentry juga dapat memproses data di Amerika Serikat dan negara lain, dengan perlindungan mereka sendiri untuk transfer data (seperti Klausul Kontrak Standar Uni Eropa).',
      ],
    },
    {
      id: 'retention',
      title: 'Berapa lama kami menyimpannya',
      blocks: [
        {
          list: [
            '**Detail akun:** selama akun itu ada.',
            '**Saat kamu menghapus akunmu:** email, negara, avatar, dan keterkaitan dengan login kamu langsung dihapus, dan nama tampilanmu diganti dengan ID anonim (nama lama langsung bisa dipilih lagi). Login Firebase kamu juga dihapus, beserta apa yang disimpannya dari Google. Jika kamu masuk dengan Google, aplikasi juga mencabut akses yang diberikan ke akun Google-mu.',
            '**Progres latihan bertahap:** salinan di server (bintangmu di setiap tahap, dan XP yang diberikan tahap-tahap itu setiap hari) dihapus bersama akunmu. Salinan di ponselmu tetap ada sampai kamu menghapus aplikasi.',
            '**Yang tetap ada setelah penghapusan, secara anonim:** pertandingan ranked, rating, XP, hasil latihan, catatan fair play, laporan yang kamu kirim, dan data penggunaan. Semua itu tidak lagi terhubung denganmu, tetapi pertandingan, replay, dan papan peringkat pemain lain tetap utuh.',
            '**Laporan, blokir, dan log admin:** blokir disimpan sampai kamu membukanya atau menghapus akunmu (saat itu semua blokirnya hilang, dari kedua arah). Laporan dan log tindakan admin disimpan selama masih diperlukan untuk menangani laporan dan menjaga game tetap aman dan adil; kami meninjaunya dari waktu ke waktu dan menghapus yang lama. Saat sebuah akun dihapus, laporan terbuka tentang akun itu ditutup, dan nama-namanya dihapus dari log admin. Jika akun itu ditangguhkan, hanya sidik jari satu arah yang dijelaskan di atas yang tersisa, sampai akun baru dengan login yang sama dibuat atau kami menghapusnya dalam peninjauan berkala.',
            '**Data penggunaan:** disimpan selama data itu membantu kami memahami cara game ini digunakan. Kami meninjaunya dari waktu ke waktu dan menghapus data lama.',
            '**Crashlytics:** Google menyimpan laporan crash hingga 90 hari. **Analytics:** selama periode retensi yang kami tetapkan di Firebase.',
          ],
        },
      ],
    },
    {
      id: 'rights',
      title: 'Hak-hakmu',
      blocks: [
        'Kamu bisa meminta untuk melihat datamu, memperbaikinya (kamu bisa mengubah nama, avatar, dan negaramu di aplikasi), menghapusnya (hapus akunmu di aplikasi), atau menolak penggunaannya. Kirim email kepada kami di {email}, dan kami akan menjawab dalam 30 hari.',
        'Kamu juga bisa mengajukan keluhan ke Otoritas Perlindungan Privasi Israel, atau ke otoritas perlindungan data di negaramu.',
      ],
    },
    {
      id: 'children',
      title: 'Anak-anak',
      blocks: [
        'Game ini tidak ditujukan untuk anak di bawah 13 tahun, dan kami tidak dengan sengaja mengumpulkan data tentang mereka. Jika kami mengetahui bahwa seorang anak di bawah 13 tahun membuka akun, kami akan menghapusnya. Jika usia minimumnya lebih tinggi, persetujuan orang tua diperlukan sampai usia tersebut.',
      ],
    },
    {
      id: 'security',
      title: 'Keamanan',
      blocks: [
        'Lalu lintas antara aplikasi dan server dienkripsi (HTTPS dan WSS). Kata sandi ditangani oleh Firebase dan tidak kami simpan. Akses ke data di server terbatas pada operator game. Tidak ada sistem yang benar-benar aman, tetapi kami melakukan upaya yang wajar untuk melindungi datamu.',
      ],
    },
    {
      id: 'changes',
      title: 'Perubahan pada kebijakan ini',
      blocks: [
        'Saat kebijakan ini berubah, kami memperbarui tanggalnya di sini. Kami juga akan mengumumkan perubahan penting di aplikasi.',
      ],
    },
    {
      id: 'contact',
      title: 'Kontak',
      blocks: ['{operator} · {email}', 'Lihat juga [ketentuan penggunaan](terms).'],
    },
  ],
};

export const TERMS_ID: LegalDoc = {
  title: 'Ketentuan penggunaan',
  lead: 'Aturan untuk menggunakan Sudoku Fight. Dengan menggunakan game ini, kamu menerima aturan tersebut.',
  sections: [
    {
      id: 'acceptance',
      title: 'Penerimaan',
      blocks: [
        'Ketentuan ini berlaku untuk aplikasi Sudoku Fight dan layanannya (“game ini”), yang dioperasikan oleh {operator} (“kami”). Dengan mendaftar atau menggunakan game ini, kamu menerima ketentuan ini dan [kebijakan privasi](privacy).',
      ],
    },
    {
      id: 'eligibility',
      title: 'Siapa yang boleh bermain',
      blocks: [
        'Kamu harus berusia minimal 13 tahun, atau usia minimum yang ditetapkan oleh hukum negaramu jika usia itu lebih tinggi. Jika usiamu di bawah 18 tahun, kamu memerlukan persetujuan orang tua atau wali.',
      ],
    },
    {
      id: 'account',
      title: 'Akunmu',
      blocks: [
        {
          list: [
            'Satu akun untuk satu orang, dengan emailmu sendiri.',
            'Jaga keamanan kata sandimu (atau akun Google yang kamu pakai untuk masuk). Kamu bertanggung jawab atas semua yang dilakukan dengan akunmu.',
            'Kamu bisa menghapus akunmu kapan saja di aplikasi: Pengaturan → Hapus akun.',
          ],
        },
      ],
    },
    {
      id: 'names',
      title: 'Nama tampilan dan perilaku',
      blocks: [
        'Nama tampilan, avatar, dan negaramu terlihat oleh semua pemain. Nama tidak boleh:',
        {
          list: [
            'bersifat menyinggung, rasis, seksual, mengancam, atau menghina;',
            'meniru orang lain, pemain lain, atau staf game;',
            'berisi data pribadi (nomor telepon, alamat), iklan, atau tautan.',
          ],
        },
        'Nama diperiksa secara otomatis terhadap daftar kata yang diblokir. Kami dapat mengubah nama yang melanggar aturan ini, meminta nama baru, atau menangguhkan akun.',
        'Reaksi di dalam game adalah emoji dari daftar yang tetap. Selama pertandingan, kamu bisa membisukan lawan dari kartunya, memblokirnya, atau melaporkannya (bagian berikutnya).',
      ],
    },
    {
      id: 'reports',
      title: 'Melaporkan dan memblokir',
      blocks: [
        'Kamu bisa melaporkan pemain dari kartunya atau dari pertandingan, dengan salah satu dari tiga alasan: nama yang menyinggung, curang, atau lainnya. **Kami meninjau setiap laporan dalam 48 jam.**',
        'Jika aturan dilanggar, kami dapat mengganti nama itu dengan nama sementara (pemain itu lalu diminta memilih nama baru, dan aturan 30 hari tidak berlaku untuk pilihan tersebut), menangguhkan akun dari pertandingan ranked dan perubahan akun sampai penangguhannya dicabut, atau menutup akun itu. Nama yang diganti dengan cara ini tidak bisa dipilih lagi. Akun yang ditangguhkan tetap bisa dihapus kapan saja, tetapi menghapusnya tidak mencabut penangguhan: akun baru dengan login yang sama dimulai dalam keadaan ditangguhkan sampai kami meninjaunya.',
        'Kamu juga bisa memblokir pemain: kamu tidak akan ditempatkan di pertandingan yang sama dengannya, dan reaksinya tidak akan ditampilkan kepadamu. Buka blokir di Pengaturan → Pemain yang diblokir. Blokir tidak menyembunyikan siapa pun dari papan peringkat.',
        'Jangan melapor tanpa alasan: laporan palsu yang berulang melanggar ketentuan ini.',
      ],
    },
    {
      id: 'fair-play',
      title: 'Fair play',
      blocks: [
        'Kamu tidak boleh:',
        {
          list: [
            'menggunakan pemecah sudoku, bot, skrip, otomatisasi, atau aplikasi yang dimodifikasi;',
            'memiliki beberapa akun untuk memengaruhi rating, mengatur hasil dengan pemain lain, atau sengaja kalah;',
            'memanfaatkan bug alih-alih melaporkannya;',
            'membebani server kami secara berlebihan, mencoba membobolnya, atau mengacaukan permainan pemain lain.',
          ],
        },
        'Server menandai pertandingan yang tidak biasa untuk ditinjau. Jika aturan dilanggar, kami dapat membatalkan hasil, mengatur ulang rating, atau menangguhkan dan menutup akun.',
      ],
    },
    {
      id: 'virtual',
      title: 'Rating, XP, dan pencapaian',
      blocks: [
        'Rating, XP, level, dan pencapaian tidak memiliki nilai uang, dan tidak dapat dipindahtangankan atau dijual. Kami dapat mengubah cara penghitungannya atau mengatur ulangnya (misalnya, di awal musim).',
        'Game ini gratis. Versi ini tidak memiliki pembelian dan tidak memiliki iklan.',
      ],
    },
    {
      id: 'service',
      title: 'Ketersediaan',
      blocks: [
        'Pertandingan ranked memerlukan koneksi internet. Saat tidak ada pemain yang tersedia, kamu mungkin dipasangkan dengan lawan yang dikendalikan komputer yang bermain dengan tempo yang mirip dengan tempomu. Pertandingan seperti itu dihitung untuk ratingmu. Game ini juga dapat menawarkan pertandingan latihan melawan bot, tanpa rating. Jika server dimulai ulang selama pertandingan ranked, pertandingan itu berakhir tanpa perubahan rating.',
        'Kami dapat mengubah, menjeda, atau menghentikan bagian-bagian game, dan kami akan berusaha memberi pemberitahuan tentang perubahan penting.',
      ],
    },
    {
      id: 'ip',
      title: 'Kekayaan intelektual',
      blocks: [
        'Game ini, beserta desain, kode, suara, dan avatarnya, adalah milik kami atau milik pihak yang melisensikannya kepada kami. Kami memberimu lisensi yang bersifat pribadi, non-eksklusif, dan non-komersial untuk menggunakan game ini berdasarkan ketentuan ini. Lisensi pihak ketiga tercantum di aplikasi: Pengaturan → Lisensi.',
      ],
    },
    {
      id: 'stores',
      title: 'Toko aplikasi',
      blocks: [
        'Apple dan Google bukan pihak dalam ketentuan ini dan tidak bertanggung jawab atas game ini. Jika kamu mengunduh game ini dari App Store, Perjanjian Lisensi Pengguna Akhir Standar (EULA) dari Apple juga berlaku, dan Apple serta anak-anak perusahaannya dapat menegakkan ketentuan ini sebagai pihak ketiga penerima manfaat.',
      ],
    },
    {
      id: 'disclaimer',
      title: 'Penafian',
      blocks: [
        'Game ini disediakan “sebagaimana adanya”. Sejauh diizinkan oleh hukum, kami tidak menjamin bahwa game ini akan berfungsi tanpa terputus atau tanpa error, dan kami tidak bertanggung jawab atas kerugian tidak langsung, data yang hilang, atau rating yang hilang. Tidak ada satu pun dalam ketentuan ini yang membatasi hak yang diberikan hukum kepadamu yang tidak dapat dikesampingkan.',
      ],
    },
    {
      id: 'termination',
      title: 'Pengakhiran',
      blocks: [
        'Kamu bisa berhenti bermain dan menghapus akunmu kapan saja. Kami dapat menangguhkan atau menutup akun yang melanggar ketentuan ini.',
      ],
    },
    {
      id: 'changes',
      title: 'Perubahan pada ketentuan ini',
      blocks: [
        'Saat ketentuan ini berubah, kami memperbarui tanggalnya di sini. Kami juga akan mengumumkan perubahan penting di aplikasi. Menggunakan game ini setelah ada perubahan berarti kamu menerima ketentuan yang baru.',
      ],
    },
    {
      id: 'law',
      title: 'Hukum yang berlaku',
      blocks: [
        'Ketentuan ini diatur oleh hukum Negara Israel, dan pengadilan yang berwenang di distrik Tel Aviv memiliki yurisdiksi eksklusif, kecuali jika hukum negaramu memberimu hak yang tidak dapat dikesampingkan.',
      ],
    },
    {
      id: 'contact',
      title: 'Kontak',
      blocks: ['{operator} · {email}'],
    },
  ],
};

export const DELETE_ACCOUNT_ID: LegalDoc = {
  title: 'Hapus akunmu',
  lead: 'Cara menghapus akunmu di Sudoku Fight, dan apa yang terjadi pada datamu.',
  sections: [
    {
      id: 'in-app',
      title: 'Di aplikasi (langsung)',
      blocks: [
        {
          list: [
            'Buka Sudoku Fight, lalu buka **Pengaturan**.',
            'Ketuk **Hapus akun**, lalu konfirmasi.',
            'Masukkan kata sandimu, atau, jika kamu masuk dengan Google, pilih lagi akun Google-mu. Akun itu langsung dihapus, dan aplikasi kembali ke layar masuk.',
          ],
          ordered: true,
        },
      ],
    },
    {
      id: 'by-email',
      title: 'Tanpa aplikasi',
      blocks: [
        'Kirim email kepada kami di {email} **dari alamat email akunmu**, dengan subjek “Hapus akun saya” dan nama tampilanmu. Kami akan memastikan bahwa permintaan itu berasal dari pemilik akun, lalu menghapus akun itu dalam 30 hari. Kami akan mengonfirmasi lewat email setelah selesai.',
      ],
    },
    {
      id: 'what',
      title: 'Apa yang dihapus dan apa yang tetap ada',
      blocks: [
        {
          list: [
            '**Langsung dihapus:** email, negara, avatar, login kamu (juga di Firebase), serta keterkaitan antara akunmu dan instalasimu. Nama tampilanmu diganti dengan ID anonim dan bebas dipakai orang lain.',
            '**Disimpan secara anonim:** pertandingan ranked, rating, XP, hasil latihan, catatan fair play, dan data penggunaan. Semua itu tidak lagi terhubung denganmu, tetapi pertandingan dan papan peringkat pemain lain tetap utuh.',
            '**Di ponselmu:** pertandingan latihan di ponselmu tetap ada sampai kamu menghapus aplikasi.',
            '**Di Google:** laporan crash disimpan hingga 90 hari, dan data Analytics selama periode retensi yang ditetapkan.',
          ],
        },
        'Selengkapnya di [kebijakan privasi](privacy).',
      ],
    },
  ],
};

/** The three documents, keyed as render.ts LEGAL_TEXTS is. */
export const LEGAL_TEXTS_ID: Record<LegalDocId, LegalDoc> = {
  privacy: PRIVACY_ID,
  terms: TERMS_ID,
  'delete-account': DELETE_ACCOUNT_ID,
};

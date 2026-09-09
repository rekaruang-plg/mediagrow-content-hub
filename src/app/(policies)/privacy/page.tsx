import type { Metadata } from "next";

export const metadata: Metadata = { title: "Kebijakan Privasi | MediaGrow Content Hub", description: "Informasi pemrosesan data dan cara meminta penghapusan data di MediaGrow Content Hub." };

export default function PrivacyPage() {
  return <>
    <h1>Kebijakan Privasi</h1><p className="policy-date">Diperbarui: 9 September 2026</p>
    <p>MediaGrow Content Hub adalah layanan MediaGrow untuk tim yang mengelola konten dan penjadwalan publikasi beberapa brand di Facebook dan Instagram. Kebijakan ini menjelaskan data yang diproses melalui layanan ini.</p>
    <h2>Data yang diproses</h2>
    <ul><li>Data akun tim: email, identitas akun, serta keanggotaan dan peran dalam workspace.</li><li>Data brand dan konten: nama brand, zona waktu, gambar atau video yang diunggah, judul, brief, caption, channel, serta jadwal publikasi.</li><li>Data koneksi Meta sesuai izin yang diberikan: identitas pengguna untuk proses otorisasi, daftar Page yang dapat dikelola, ID dan nama Page, akun Instagram profesional yang terkait, username, izin, akses publikasi, token akses dan informasi kedaluwarsanya.</li><li>Data operasional: status pekerjaan publikasi, ID atau tautan posting, hasil dan kegagalan pemrosesan, serta catatan aktivitas. Infrastruktur hosting dan autentikasi dapat memproses informasi teknis permintaan, seperti alamat IP dan informasi perangkat, untuk mengoperasikan dan melindungi layanan.</li></ul>
    <h2>Tujuan penggunaan</h2>
    <p>Data digunakan untuk mengautentikasi anggota tim, membatasi akses sesuai workspace dan brand, menampilkan akun yang dapat dipilih, menyimpan bahan konten, menjadwalkan dan mengirim publikasi yang diminta, serta menangani kegagalan dan permintaan bantuan. Menghubungkan akun saja tidak membuat jadwal publikasi baru.</p>
    <h2>Akses dan penyedia layanan</h2>
    <p>Data workspace dapat diakses oleh anggota tim sesuai izin mereka dan oleh pengelola layanan untuk operasional serta dukungan. Layanan menggunakan Supabase untuk autentikasi, database dan penyimpanan berkas; Vercel untuk hosting aplikasi dan perantara layanan AI; serta layanan Meta untuk otorisasi dan publikasi. Saat pengguna meminta Caption Otomatis, nama brand, kategori, judul, brief, format, channel, dan panduan Brand Kit yang relevan dikirim ke penyedia model AI untuk menghasilkan alternatif caption. Media tidak dikirim oleh fitur Caption Otomatis saat ini. Permintaan AI dibatasi ke penyedia yang menyatakan prompt tidak digunakan untuk pelatihan melalui pengaturan gateway. Penyedia tersebut memproses data yang diperlukan untuk menjalankan fungsinya. Infrastruktur penyedia dapat berada di luar negara pengguna.</p>
    <p>Konten yang diterbitkan dikirim ke akun Facebook atau Instagram yang dipilih dan mengikuti pengaturan audiens serta kebijakan platform tersebut.</p>
    <h2>Sesi dan keamanan</h2>
    <p>Aplikasi menggunakan penyimpanan sesi pada browser untuk login tim dan cookie sementara untuk menghubungkan akun Meta. Cookie koneksi berlaku sekitar sepuluh menit. Token akses yang disimpan dalam database dienkripsi; akses aplikasi dibatasi menggunakan autentikasi dan izin workspace. Jangan membagikan kata sandi, token akses atau kunci rahasia melalui brief, caption maupun email bantuan.</p>
    <h2>Penyimpanan dan penghapusan</h2>
    <p>Data akun, konten, koneksi dan riwayat disimpan untuk mendukung penggunaan workspace. Layanan saat ini tidak memiliki penghapusan otomatis berdasarkan usia data. Penghapusan dapat diminta melalui prosedur di bawah; cakupan data bersama perlu dikonfirmasi dengan pihak yang berwenang mengelola workspace.</p>
    <p>Mencabut izin Meta menghentikan akses sesuai perubahan yang diberlakukan Meta, tetapi tidak otomatis menghapus salinan data yang telah tersimpan di MediaGrow. Menghapus data MediaGrow juga tidak otomatis menghapus posting yang sudah terbit di Facebook atau Instagram. Salinan cadangan dan catatan infrastruktur mengikuti siklus penyimpanan penyedia layanan.</p>
    <h2>Pilihan dan permintaan pengguna</h2>
    <p>Kamu dapat meminta penjelasan, koreksi, atau penghapusan data dengan menghubungi <a href="mailto:racingpempek@gmail.com">racingpempek@gmail.com</a>, kontak pengelola MediaGrow Content Hub. Ikuti <a href="/data-deletion">petunjuk penghapusan data</a> untuk menjelaskan akun dan cakupan permintaan. Pengelola perlu memverifikasi kewenangan pemohon sebelum mengubah data.</p>
    <h2>Perubahan kebijakan</h2>
    <p>Perubahan cara pemrosesan data akan dicerminkan pada halaman ini dengan tanggal pembaruan. Hubungi kontak pengelola jika ada pertanyaan mengenai kebijakan ini.</p>
  </>;
}

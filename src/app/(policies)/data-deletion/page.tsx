import type { Metadata } from "next";

export const metadata: Metadata = { title: "Penghapusan Data | MediaGrow Content Hub", description: "Cara meminta penghapusan data akun dan koneksi Facebook atau Instagram dari MediaGrow Content Hub." };

export default function DataDeletionPage() {
  return <>
    <h1>Petunjuk Penghapusan Data</h1><p className="policy-date">Diperbarui: 8 September 2026</p>
    <p>Penghapusan data MediaGrow Content Hub diproses melalui permintaan kepada pengelola. Halaman ini berisi petunjuk permintaan, bukan formulir penghapusan otomatis.</p>
    <h2>Ajukan permintaan</h2>
    <ol><li>Kirim email ke <a href="mailto:racingpempek@gmail.com?subject=Permintaan%20Penghapusan%20Data%20MediaGrow">racingpempek@gmail.com</a> dengan subjek <strong>Permintaan Penghapusan Data MediaGrow</strong>. Gunakan email yang terdaftar di MediaGrow bila masih dapat diakses.</li><li>Sebutkan nama workspace atau brand, email akun MediaGrow, serta nama atau ID Page/username Instagram yang terkait jika permintaan menyangkut koneksi Meta.</li><li>Jelaskan cakupannya: akun tim, koneksi dan token Meta, konten beserta berkas unggahan, jadwal yang belum terbit, atau seluruh data brand yang kamu berwenang kelola.</li><li>Pengelola akan memverifikasi identitas dan kewenangan, mengonfirmasi cakupan data bersama serta jadwal yang perlu dihentikan, lalu memberikan hasil penanganan melalui email. Kamu dapat menanyakan status dengan membalas percakapan email yang sama.</li></ol>
    <p>Jangan menyertakan kata sandi Facebook/Instagram, OTP, App Secret atau token akses. Jika email akun tidak dapat diakses, jelaskan kondisi tersebut agar pengelola dapat menentukan langkah verifikasi yang sesuai.</p>
    <h2>Mencabut akses Meta</h2>
    <p>Kamu juga dapat mencabut akses MediaGrow melalui pengaturan aplikasi atau integrasi bisnis pada akun Facebook yang digunakan saat menghubungkan brand. Pencabutan izin dan permintaan penghapusan data MediaGrow adalah dua tindakan terpisah. Mengirim email permintaan saja belum otomatis menghentikan pekerjaan publikasi yang sudah dijadwalkan; sebutkan jadwal yang perlu dihentikan dalam permintaan.</p>
    <h2>Dampak dan batas penghapusan</h2>
    <p>Menghapus koneksi dapat membuat jadwal terkait tidak dapat dipublikasikan. Menghapus berkas atau konten dapat menghilangkan bahan dan riwayat yang digunakan tim. Karena itu, pengelola perlu mengonfirmasi kewenangan atas data bersama sebelum melakukan penghapusan.</p>
    <p>Posting yang sudah terbit tetap perlu dikelola atau dihapus melalui Facebook/Instagram. Salinan cadangan dan catatan teknis infrastruktur mengikuti siklus penyimpanan penyedia layanan; penghapusan dari sistem aktif tidak berarti seluruh cadangan langsung terhapus pada saat yang sama.</p>
    <p>Baca juga <a href="/privacy">Kebijakan Privasi MediaGrow Content Hub</a>.</p>
  </>;
}

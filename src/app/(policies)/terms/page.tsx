import type { Metadata } from "next";

export const metadata: Metadata = { title: "Ketentuan Layanan | MediaGrow Content Hub", description: "Ketentuan penggunaan workspace, koneksi akun dan penjadwalan konten MediaGrow Content Hub." };

export default function TermsPage() {
  return <>
    <h1>Ketentuan Layanan</h1><p className="policy-date">Diperbarui: 9 September 2026</p>
    <p>MediaGrow Content Hub membantu tim mengunggah bahan, menghubungkan akun brand, serta menjadwalkan publikasi ke Facebook dan Instagram.</p>
    <h2>Kewenangan dan konten</h2><p>Gunakan layanan hanya untuk workspace dan akun brand yang kamu berwenang kelola. Pastikan kamu memiliki izin atas konten yang diunggah dan bahwa materi tersebut sesuai dengan kebijakan platform tujuan. Jaga kerahasiaan akun tim serta periksa akses anggota workspace.</p>
    <h2>Penjadwalan dan publikasi</h2><p>Periksa brand, akun tujuan, media, caption, channel, zona waktu dan jadwal sebelum mengirim konten untuk dipublikasikan. Pekerjaan yang sudah dijadwalkan dapat diproses otomatis tanpa konfirmasi tambahan pada waktu publikasi.</p><p>Publikasi bergantung pada izin akun, validitas token, format media, batas API, serta ketersediaan Meta dan infrastruktur layanan. Jadwal dapat mengalami keterlambatan atau kegagalan. Periksa status pekerjaan dan hasil di platform tujuan.</p>
    <h2>Caption Otomatis</h2><p>Alternatif caption yang dihasilkan AI adalah draf bantuan dan dapat mengandung kesalahan. Pengguna tetap bertanggung jawab memeriksa fakta, harga, promo, klaim, hak atas materi, dan kesesuaian dengan kebijakan brand serta platform sebelum menyimpan atau menjadwalkan konten.</p>
    <h2>Data dan bantuan</h2><p>Pemrosesan data dijelaskan dalam <a href="/privacy">Kebijakan Privasi</a>. Untuk bantuan, koreksi atau penghentian penggunaan, hubungi <a href="mailto:racingpempek@gmail.com">racingpempek@gmail.com</a>. Permintaan penghapusan mengikuti <a href="/data-deletion">petunjuk penghapusan data</a>.</p>
  </>;
}

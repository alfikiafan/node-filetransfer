// server.js
const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');

// Konfigurasi Port
const TCP_PORT = 5000;
const UDP_PORT = 5001;

// Direktori yang berisi file yang dapat diakses oleh client
const FILES_DIR = path.join(__dirname, 'files');

// Pastikan direktori file ada
if (!fs.existsSync(FILES_DIR)) {
    console.error(`Direktori file tidak ditemukan: ${FILES_DIR}`);
    process.exit(1);
}

// Fungsi untuk memvalidasi dan mendapatkan path file
function getFilePath(requestedPath) {
    // Hindari traversal path dengan mengizinkan hanya file di dalam FILES_DIR
    const safePath = path.normalize(requestedPath).replace(/^(\.\.(\/|\\|$))+/, '');
    const fullPath = path.join(FILES_DIR, safePath);
    if (fullPath.startsWith(FILES_DIR)) {
        return fullPath;
    } else {
        return null;
    }
}

// Membuat Server TCP
const tcpServer = net.createServer((socket) => {
    console.log('TCP client terhubung.');

    let dataBuffer = '';

    socket.on('data', (data) => {
        dataBuffer += data.toString();
    });

    socket.on('end', () => {
        const requestedPath = dataBuffer.trim();
        console.log(`TCP Client meminta file: ${requestedPath}`);

        const filePath = getFilePath(requestedPath);
        if (!filePath || !fs.existsSync(filePath)) {
            const errorMsg = 'ERROR: File tidak ditemukan atau akses ditolak.\n';
            socket.write(errorMsg, () => {
                socket.end();
            });
            console.error(`TCP: File tidak ditemukan atau akses ditolak: ${requestedPath}`);
            return;
        }

        // Mengirimkan isi file
        const readStream = fs.createReadStream(filePath);
        readStream.pipe(socket);

        readStream.on('end', () => {
            console.log(`TCP: Pengiriman file selesai: ${requestedPath}`);
        });

        readStream.on('error', (err) => {
            console.error(`TCP: Error membaca file: ${err.message}`);
            socket.end();
        });
    });

    socket.on('error', (err) => {
        console.error(`TCP Socket Error: ${err.message}`);
    });
});

// Mulai Mendengarkan TCP
tcpServer.listen(TCP_PORT, () => {
    console.log(`TCP Server berjalan pada port ${TCP_PORT}`);
});

// Membuat Server UDP
const udpServer = dgram.createSocket('udp4');

udpServer.on('listening', () => {
    const address = udpServer.address();
    console.log(`UDP Server berjalan pada port ${address.port}`);
});

udpServer.on('message', (msg, rinfo) => {
    const requestedPath = msg.toString().trim();
    console.log(`UDP Client meminta file: ${requestedPath} dari ${rinfo.address}:${rinfo.port}`);

    const filePath = getFilePath(requestedPath);
    if (!filePath || !fs.existsSync(filePath)) {
        const errorMsg = 'ERROR: File tidak ditemukan atau akses ditolak.\n';
        udpServer.send(errorMsg, rinfo.port, rinfo.address, (err) => {
            if (err) console.error(`UDP: Gagal mengirim pesan error: ${err.message}`);
        });
        console.error(`UDP: File tidak ditemukan atau akses ditolak: ${requestedPath}`);
        return;
    }

    // Mengirimkan isi file sebagai buffer
    fs.readFile(filePath, (err, data) => {
        if (err) {
            const errorMsg = 'ERROR: Gagal membaca file.\n';
            udpServer.send(errorMsg, rinfo.port, rinfo.address, (err) => {
                if (err) console.error(`UDP: Gagal mengirim pesan error: ${err.message}`);
            });
            console.error(`UDP: Error membaca file: ${err.message}`);
            return;
        }

        // Karena UDP memiliki batas ukuran paket, kirim dalam beberapa paket jika diperlukan
        const MAX_UDP_SIZE = 60000; // 60 KB per paket
        const totalSize = data.length;
        let offset = 0;

        function sendChunk() {
            if (offset >= totalSize) {
                console.log(`UDP: Pengiriman file selesai: ${requestedPath}`);
                return;
            }

            const end = Math.min(offset + MAX_UDP_SIZE, totalSize);
            const chunk = data.slice(offset, end);
            udpServer.send(chunk, 0, chunk.length, rinfo.port, rinfo.address, (err) => {
                if (err) {
                    console.error(`UDP: Gagal mengirim chunk: ${err.message}`);
                    return;
                }
                offset = end;
                // Kirim chunk berikutnya
                sendChunk();
            });
        }

        sendChunk();
    });
});

udpServer.on('error', (err) => {
    console.error(`UDP Server Error:\n${err.stack}`);
    udpServer.close();
});

// Mulai Mendengarkan UDP
udpServer.bind(UDP_PORT);

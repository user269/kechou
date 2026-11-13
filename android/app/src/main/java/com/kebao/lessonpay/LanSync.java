package com.kebao.lessonpay;

import android.content.Context;
import android.os.Build;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.BufferedInputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 局域网直传：两台手机在同一个 WiFi 下直接换数据，不经过任何服务器。
 *
 * 一台起极简 HTTP 服务（随机端口），另一台作为客户端拉取 + 推送；
 * 地址靠 UDP 广播互相发现，找不到就退回手动输入 IP。
 *
 * 只做三件事：GET /snapshot 取对方数据、POST /apply 把自己的交过去、GET /ping 探活。
 * 协议故意做得极简——这东西只在同一个局域网里跑几秒钟，不需要通用性。
 */
public final class LanSync {

    private static final String TAG = "LanSync";
    private static final int DISCOVERY_PORT = 45877;
    private static final String PROBE = "KEBAO_WHO";
    private static final String REPLY = "KEBAO_HERE";

    private static ServerSocket serverSocket;
    private static Thread serverThread;
    private static DatagramSocket udp;
    private static Thread udpThread;

    private static volatile int httpPort = 0;
    private static volatile String snapshot = "{}";
    /** 配对码：对方必须知道这 4 位数字才能把数据拉走，光扫到 IP 没用 */
    private static volatile String pairCode = "";
    private static volatile String localAddress = "";

    /** 对方推过来的包，等网页来取 */
    private static final List<String> inbox = Collections.synchronizedList(new ArrayList<String>());
    /** 扫描结果：key = ip:port，value = {ip, port, name, at} */
    private static final Map<String, String[]> peers = Collections.synchronizedMap(new LinkedHashMap<String, String[]>());

    private LanSync() { }

    /* ---------------- 生命周期 ---------------- */

    static synchronized String start(Context ctx) {
        stop();
        try {
            serverSocket = new ServerSocket(0);          // 端口交给系统挑，避免和别的应用撞车
            serverSocket.setReuseAddress(true);
            httpPort = serverSocket.getLocalPort();
            localAddress = localIp();

            serverThread = new Thread(LanSync::serveLoop, "kebao-lan-http");
            serverThread.setDaemon(true);
            serverThread.start();

            udp = new DatagramSocket(null);
            udp.setReuseAddress(true);
            udp.setBroadcast(true);
            udp.bind(new InetSocketAddress(DISCOVERY_PORT));
            udp.setSoTimeout(500);

            udpThread = new Thread(LanSync::discoverLoop, "kebao-lan-udp");
            udpThread.setDaemon(true);
            udpThread.start();

            pairCode = String.format(java.util.Locale.US, "%04d", 1000 + new java.util.Random().nextInt(9000));
            return "{\"ok\":true,\"ip\":\"" + esc(localAddress) + "\",\"port\":" + httpPort
                    + ",\"code\":\"" + pairCode + "\"}";
        } catch (Exception e) {
            stop();
            return "{\"ok\":false,\"msg\":\"" + esc("没能开启：" + describe(e)) + "\"}";
        }
    }

    static synchronized void stop() {
        try { if (serverSocket != null) serverSocket.close(); } catch (Exception ignored) { }
        try { if (udp != null) udp.close(); } catch (Exception ignored) { }
        if (serverThread != null) serverThread.interrupt();
        if (udpThread != null) udpThread.interrupt();
        serverSocket = null;
        udp = null;
        serverThread = null;
        udpThread = null;
        httpPort = 0;
        pairCode = "";
        inbox.clear();
        peers.clear();
    }

    /** 网页每次保存后把最新的包交过来，别人来取就能拿到当前的 */
    static void publish(String json) {
        if (json != null && json.length() > 2) snapshot = json;
    }

    /* ---------------- HTTP 服务 ---------------- */

    private static void serveLoop() {
        while (true) {
            Socket s = null;
            try {
                s = serverSocket.accept();
                handle(s);
            } catch (Exception e) {
                if (serverSocket == null || serverSocket.isClosed()) return;
                Log.w(TAG, "accept: " + describe(e));
            } finally {
                try { if (s != null) s.close(); } catch (Exception ignored) { }
            }
        }
    }

    private static void handle(Socket s) throws IOException {
        s.setSoTimeout(8000);
        InputStream in = new BufferedInputStream(s.getInputStream());

        String requestLine = readLine(in);
        if (requestLine == null) return;
        String[] parts = requestLine.split(" ");
        if (parts.length < 2) return;
        String method = parts[0];
        String path = parts[1];

        int length = 0;
        String from = "";
        String line;
        while ((line = readLine(in)) != null) {
            if (line.length() == 0) break;
            int i = line.indexOf(':');
            if (i <= 0) continue;
            String k = line.substring(0, i).trim().toLowerCase();
            String v = line.substring(i + 1).trim();
            if (k.equals("content-length")) {
                try { length = Integer.parseInt(v); } catch (Exception ignored) { }
            } else if (k.equals("x-kebao-from")) {
                from = v;
            }
        }

        if ("GET".equals(method) && path.startsWith("/snapshot")) {
            // 数据是工资，不能谁扫到 IP 就给。要求带上本机屏幕上显示的配对码
            String given = queryParam(path, "code");
            if (pairCode.isEmpty() || !pairCode.equals(given)) {
                respond(s, 401, "{\"ok\":false,\"msg\":\"pair code required\"}");
                return;
            }
            respond(s, 200, snapshot);
            return;
        }
        if ("GET".equals(method) && path.startsWith("/ping")) {
            respond(s, 200, "{\"ok\":true,\"app\":\"kebao\",\"name\":\"" + esc(deviceName()) + "\"}");
            return;
        }
        if ("POST".equals(method) && path.startsWith("/apply")) {
            if (length <= 0 || length > 8 * 1024 * 1024) {
                respond(s, 400, "{\"ok\":false,\"msg\":\"empty\"}");
                return;
            }
            byte[] body = new byte[length];
            int off = 0;
            while (off < length) {
                int n = in.read(body, off, length - off);
                if (n < 0) break;
                off += n;
            }
            String text = new String(body, 0, off, StandardCharsets.UTF_8);
            if (text.contains("\"kbsync\"")) {
                inbox.add("{\"from\":\"" + esc(from) + "\",\"packet\":" + text + "}");
                respond(s, 200, "{\"ok\":true}");
            } else {
                respond(s, 400, "{\"ok\":false,\"msg\":\"not kbsync\"}");
            }
            return;
        }
        respond(s, 404, "{\"ok\":false}");
    }

    private static void respond(Socket s, int code, String body) throws IOException {
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        OutputStream out = s.getOutputStream();
        String head = "HTTP/1.1 " + code + " " + (code == 200 ? "OK" : "ERR") + "\r\n"
                + "Content-Type: application/json; charset=utf-8\r\n"
                + "Content-Length: " + b.length + "\r\n"
                + "Connection: close\r\n"
                + "\r\n";
        out.write(head.getBytes(StandardCharsets.UTF_8));
        out.write(b);
        out.flush();
    }

    /** 从 "/snapshot?code=1234" 里取参数 */
    private static String queryParam(String path, String key) {
        int q = path.indexOf('?');
        if (q < 0) return "";
        String[] parts = path.substring(q + 1).split("&");
        for (String p : parts) {
            int e = p.indexOf('=');
            if (e > 0 && p.substring(0, e).equals(key)) {
                try {
                    return java.net.URLDecoder.decode(p.substring(e + 1), "UTF-8");
                } catch (Exception ignored) { return p.substring(e + 1); }
            }
        }
        return "";
    }

    /** 按行读，但底层是字节流——用 BufferedReader 会把 body 一起吞进缓冲里 */
    private static String readLine(InputStream in) throws IOException {
        StringBuilder sb = new StringBuilder();
        boolean any = false;
        int c;
        while ((c = in.read()) != -1) {
            any = true;
            if (c == '\n') return sb.toString();
            if (c != '\r') sb.append((char) c);
            if (sb.length() > 8192) break;
        }
        return any ? sb.toString() : null;
    }

    /* ---------------- 发现 ---------------- */

    private static void discoverLoop() {
        byte[] buf = new byte[1024];
        while (true) {
            DatagramPacket p = new DatagramPacket(buf, buf.length);
            try {
                udp.receive(p);
                String msg = new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8).trim();
                String fromIp = p.getAddress().getHostAddress();

                if (msg.startsWith(PROBE)) {
                    // 自己的广播会绕回来，别理它
                    if (fromIp.equals(localAddress)) continue;
                    if (httpPort <= 0) continue;
                    String reply = REPLY + "|" + deviceName() + "|" + httpPort;
                    byte[] r = reply.getBytes(StandardCharsets.UTF_8);
                    udp.send(new DatagramPacket(r, r.length, p.getAddress(), p.getPort()));
                } else if (msg.startsWith(REPLY)) {
                    String[] f = msg.split("\\|");
                    if (f.length >= 3 && !fromIp.equals(localAddress)) {
                        peers.put(fromIp + ":" + f[2], new String[]{
                                fromIp, f[2], f[1], String.valueOf(System.currentTimeMillis())
                        });
                    }
                }
            } catch (SocketTimeoutException e) {
                if (udp == null || udp.isClosed()) return;
            } catch (Exception e) {
                if (udp == null || udp.isClosed()) return;
                Log.w(TAG, "udp: " + describe(e));
            }
        }
    }

    static String scan(int timeoutMs) {
        if (udp == null || udp.isClosed()) {
            return "{\"ok\":false,\"peers\":[],\"msg\":\"" + esc("先点「开启接收」") + "\"}";
        }
        peers.clear();
        try {
            byte[] m = PROBE.getBytes(StandardCharsets.UTF_8);
            sendProbe(m, "255.255.255.255");
            String sub = subnetBroadcast();
            if (sub != null) sendProbe(m, sub);   // 有些路由器只转其中一种广播
            Thread.sleep(Math.max(800, Math.min(timeoutMs, 6000)));
        } catch (Exception e) {
            return "{\"ok\":false,\"peers\":[],\"msg\":\"" + esc(describe(e)) + "\"}";
        }

        StringBuilder sb = new StringBuilder("{\"ok\":true,\"peers\":[");
        boolean first = true;
        long now = System.currentTimeMillis();
        synchronized (peers) {
            for (String[] v : peers.values()) {
                long at = safeLong(v[3]);
                if (now - at > 20000) continue;      // 半分钟前的旧结果不算
                if (!first) sb.append(',');
                first = false;
                sb.append("{\"ip\":\"").append(esc(v[0])).append("\",\"port\":").append(safeLong(v[1]))
                        .append(",\"name\":\"").append(esc(v[2])).append("\"}");
            }
        }
        return sb.append("]}").toString();
    }

    private static void sendProbe(byte[] m, String host) {
        try {
            udp.send(new DatagramPacket(m, m.length, InetAddress.getByName(host), DISCOVERY_PORT));
        } catch (Exception ignored) { }
    }

    /* ---------------- 客户端 ---------------- */

    /**
     * 先拉对方的、再把自己的推过去。
     * 两边都合并一次，结果也就两边都齐了——不用第二次握手。
     */
    static String sync(String ip, int port, String code, String packet) {
        if (ip == null || ip.trim().isEmpty() || port <= 0) {
            return "{\"ok\":false,\"msg\":\"" + esc("地址不对") + "\"}";
        }
        if (code == null || code.trim().isEmpty()) {
            return "{\"ok\":false,\"msg\":\"" + esc("先输入对方屏幕上显示的 4 位配对码") + "\"}";
        }
        String base = "http://" + ip.trim() + ":" + port;
        String pulled = request("GET", base + "/snapshot?code=" + code.trim(), null);
        if (pulled == null) {
            return "{\"ok\":false,\"msg\":\"" + esc("连不上，或者配对码不对") + "\"}";
        }
        String posted = request("POST", base + "/apply", packet);
        String body = (pulled.trim().isEmpty() || pulled.trim().equals("null")) ? "{}" : pulled.trim();
        return "{\"ok\":true,\"pulled\":" + body + ",\"pushed\":" + (posted != null) + "}";
    }

    private static String request(String method, String urlStr, String body) {
        HttpURLConnection c = null;
        try {
            URL u = new URL(urlStr);
            c = (HttpURLConnection) u.openConnection();
            c.setConnectTimeout(4000);
            c.setReadTimeout(12000);
            c.setRequestMethod(method);
            c.setRequestProperty("Accept", "application/json");
            if (body != null) {
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                byte[] b = body.getBytes(StandardCharsets.UTF_8);
                c.setFixedLengthStreamingMode(b.length);
                OutputStream os = c.getOutputStream();
                os.write(b);
                os.flush();
                os.close();
            }
            int code = c.getResponseCode();
            if (code < 200 || code >= 300) return null;
            InputStream in = c.getInputStream();
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            in.close();
            return new String(bo.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            Log.w(TAG, method + " " + urlStr + " → " + describe(e));
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /* ---------------- 工具 ---------------- */

    static String inbox() {
        List<String> copy;
        synchronized (inbox) {
            copy = new ArrayList<>(inbox);
            inbox.clear();
        }
        StringBuilder sb = new StringBuilder("{\"items\":[");
        for (int i = 0; i < copy.size(); i++) {
            if (i > 0) sb.append(',');
            sb.append(copy.get(i));
        }
        return sb.append("]}").toString();
    }

    static String deviceName() {
        String m = Build.MODEL == null ? "" : Build.MODEL.trim();
        if (m.isEmpty()) return "安卓设备";
        return m.length() > 20 ? m.substring(0, 20) : m;
    }

    /** 本机在局域网里的 IPv4 地址（跳过流量卡、VPN 之类的接口） */
    private static String localIp() {
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                String n = ni.getName() == null ? "" : ni.getName();
                if (n.startsWith("rmnet") || n.startsWith("tun") || n.startsWith("dummy")
                        || n.startsWith("p2p") || n.startsWith("ccmni")) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) {
                        return a.getHostAddress();
                    }
                }
            }
        } catch (Exception ignored) { }
        return "";
    }

    /** 按 /24 推一个子网广播地址，某些路由不转 255.255.255.255 但认这个 */
    private static String subnetBroadcast() {
        String ip = localAddress;
        if (ip == null || ip.isEmpty()) return null;
        int i = ip.lastIndexOf('.');
        if (i <= 0) return null;
        return ip.substring(0, i + 1) + "255";
    }

    private static long safeLong(String v) {
        try { return Long.parseLong(v); } catch (Exception e) { return 0L; }
    }

    private static String describe(Exception e) {
        String m = e.getMessage();
        return (m == null || m.isEmpty()) ? e.getClass().getSimpleName() : m;
    }

    private static String esc(String s) {
        if (s == null) return "";
        StringBuilder sb = new StringBuilder(s.length() + 8);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) sb.append(' ');
                    else sb.append(c);
            }
        }
        return sb.toString();
    }
}

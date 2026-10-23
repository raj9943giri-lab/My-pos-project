package com.example.pos;

import android.annotation.SuppressLint;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;

import java.io.File;
import java.io.FileOutputStream;

/**
 * POS - Merchant point-of-sale app.
 * Loads the full POS UI (Hindi-first) from assets/index.html.
 * assets/customer.html and assets/admin.html are separate platform previews
 * reachable from POS Settings (PART 1 demo switcher).
 *
 * PART 6: POSAndroid JS-bridge — merchant share screen से
 *   - native share sheet (ACTION_SEND chooser)
 *   - WhatsApp deep-link (इंस्टॉल हो ही तो खुलेगा; नहीं तो share-sheet fallback)
 *   - clipboard copy, दुकान URL ब्राउज़र में खोलना, QR PNG सेव, प्रिंट
 * सिर्फ़ @JavascriptInterface ही उजागर होते हैं.
 */
public class MainActivity extends AppCompatActivity {

    private static final String START_URL = "file:///android_asset/index.html";

    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        window.setStatusBarColor(Color.parseColor("#046A4A"));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            window.setNavigationBarColor(Color.parseColor("#FFFFFF"));
        }

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        webView.setBackgroundColor(Color.WHITE);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        // PART 2: SPA (file://) अब optional backend पर REST कॉल (fetch) करता है।
        // file:// origin से cross-origin XHR/fetch के लिए दो ऐतिहासिक फ़्लैग ज़रूरी हैं
        // (deprecated but functional; WebView में file:// पर ही लागू — नॉर्मल ब्राउज़र व्यवहार अछूता)
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);

        webView.addJavascriptInterface(new POSAndroidBridge(), "POSAndroid");

        webView.setWebChromeClient(new WebChromeClient());

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl().toString());
            }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(url);
            }
        });

        webView.loadUrl(START_URL);
        setContentView(webView);
    }

    /**
     * Internal asset pages (index/customer/admin) stay inside the WebView.
     * http(s), tel:, mailto:, wa.me etc. open with an external app.
     */
    private boolean handleUrl(String url) {
        if (url == null) {
            return false;
        }
        if (url.startsWith("file:///android_asset/")) {
            return false; // load inside WebView
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception ignored) {
            // no external handler installed; stay on current page
        }
        return true;
    }

    /**
     * PART 6 — घरेलू bridge: index.html का JS इन्हीं @JavascriptInterface methods
     * को window.POSAndroid.* से बुलाता है. हर method आस-पास try/catch — कोई
     * handler/device न मिले तो churn-safe fallback (JS side) चलता है.
     */
    private class POSAndroidBridge {

        /**
         * PART 8 — build-time API base (Gradle -PposApiBase). ख़ाली स्ट्रिंग =
         * runtime Settings/localStorage वाला पुराना व्यवहार.
         */
        @JavascriptInterface
        public String apiBase() {
            try {
                return BuildConfig.POS_API_BASE == null ? "" : BuildConfig.POS_API_BASE;
            } catch (Exception e) {
                return "";
            }
        }

        /**
         * Android की native share sheet: ACTION_SEND text/plain + chooser.
         * @return "ok" | "no-app" (कोई share handler नहीं)
         */
        @JavascriptInterface
        public String share(String subject, String text) {
            try {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("text/plain");
                send.putExtra(Intent.EXTRA_SUBJECT,
                        subject == null ? "" : subject);
                send.putExtra(Intent.EXTRA_TEXT, text == null ? "" : text);
                Intent chooser = Intent.createChooser(send,
                        "दुकान का लिंक शेयर करें");
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(chooser);
                return "ok";
            } catch (Exception e) {
                return "no-app";
            }
        }

        /**
         * WhatsApp deep-link https://wa.me/?text=… — सिर्फ़ इंस्टॉल होने पर खुलेगा
         * (WhatsApp/WhatsApp Business). संदेश अपने-आप नहीं भेजा जाता — WhatsApp
         * कंपोज़ स्क्रीन खुलती है, भेजना दुकानदार के हाथ में.
         * @return जिस package से खुला ("com.whatsapp"|"com.whatsapp.w4b") या "" (इंस्टॉल नहीं)
         */
        @JavascriptInterface
        public String whatsapp(String text) {
            try {
                Uri uri = Uri.parse("https://wa.me/?text="
                        + Uri.encode(text == null ? "" : text));
                String[] pkgs = {"com.whatsapp", "com.whatsapp.w4b"};
                for (String pkg : pkgs) {
                    try {
                        Intent i = new Intent(Intent.ACTION_VIEW, uri);
                        i.setPackage(pkg);
                        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i);
                        return pkg;
                    } catch (Exception notInstalled) {
                        // अगला package आज़माओ / अंत में "" लौटेगा → JS fallback
                    }
                }
            } catch (Exception ignored) {
            }
            return "";
        }

        /** Clipboard में लिखो. */
        @JavascriptInterface
        public void copy(String text) {
            try {
                ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                if (cm != null) {
                    cm.setPrimaryClip(ClipData.newPlainText("POS", text == null ? "" : text));
                }
            } catch (Exception ignored) {
            }
        }

        /** दुकान का public URL बाहर (browser) खोलो. @return true खुला. */
        @JavascriptInterface
        public boolean openUrl(String url) {
            try {
                Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        /**
         * QR PNG सेव — ऐप की own Pictures folder में (कोई storage permission नहीं).
         * @return असली फ़ाइल-पथ या "" (fail; JS जागरूक करता है)
         */
        @JavascriptInterface
        public String saveImage(String base64, String fileName) {
            try {
                String data = base64 == null ? "" : base64;
                int comma = data.indexOf(',');
                if (data.startsWith("data:") && comma >= 0) data = data.substring(comma + 1);
                if (data.isEmpty()) return "";
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                File dir = getExternalFilesDir(Environment.DIRECTORY_PICTURES);
                if (dir == null) return "";
                String name = (fileName == null || fileName.trim().isEmpty())
                        ? ("pos-qr-" + System.currentTimeMillis() + ".png")
                        : (fileName.endsWith(".png") ? fileName : fileName + ".png");
                File out = new File(dir, name);
                FileOutputStream fos = new FileOutputStream(out);
                fos.write(bytes);
                fos.close();
                return out.getAbsolutePath();
            } catch (Exception e) {
                return "";
            }
        }

        /** वर्तमान स्क्रीन (QR print view) देसी प्रिंट पर — Android print service. */
        @JavascriptInterface
        public void print() {
            if (webView == null) return;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
                        if (pm == null) return;
                        PrintDocumentAdapter adapter =
                                webView.createPrintDocumentAdapter("POS-QR");
                        pm.print("POS QR", adapter,
                                new PrintAttributes.Builder().build());
                    } catch (Exception ignored) {
                        // print service नहीं — JS "प्रिंट उपलब्ध नहीं" toast दिखाएगा
                    }
                }
            });
        }
    }

    /**
     * The JS app reports whether it consumed the back press
     * (closing a dialog or navigating back one screen).
     */
    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            finish();
            return;
        }
        webView.evaluateJavascript(
                "(function(){try{return (window.__posHandleBack && window.__posHandleBack())?1:0;}catch(e){return 0;}})()",
                value -> {
                    if (value != null && value.contains("1")) {
                        return; // JS handled it (sheet closed / previous screen routed)
                    }
                    if (webView.canGoBack()) {
                        webView.goBack();
                    } else {
                        super.onBackPressed();
                        finish();
                    }
                });
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            ((ViewGroup) webView.getParent()).removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}

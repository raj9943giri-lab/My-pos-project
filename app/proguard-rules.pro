# POS WebView app — keep assets loader classes intact (no R8 shrink for now).

# PART 6 — @JavascriptInterface bridge methods must survive R8/ProGuard,
# warna window.POSAndroid.share/whatsapp/... JS से अदृश्य हो जाते हैं.
-keepattributes JavascriptInterface
-keepclassmembers class com.example.pos.MainActivity$POSAndroidBridge {
    public *;
}

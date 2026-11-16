package com.mataman03.nightwatch;

import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Runs the game full screen: no status bar or navigation bar (swipe from an edge to see them
 * for a moment), drawn right up to the edges and around the camera hole. The game is told how
 * tall the camera area is so it can keep its score and buttons below it.
 */
public class MainActivity extends BridgeActivity {
    private int safeTopCssPx = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        goFullScreen();

        ViewCompat.setOnApplyWindowInsetsListener(getWindow().getDecorView(), (view, insets) -> {
            Insets cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
            float density = getResources().getDisplayMetrics().density;
            safeTopCssPx = Math.round(cutout.top / density);
            sendSafeTop();
            return ViewCompat.onApplyWindowInsets(view, insets);
        });
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            goFullScreen(); // the bars come back after leaving the app, so hide them again
            sendSafeTop();
        }
    }

    private void goFullScreen() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }

    private void sendSafeTop() {
        if (bridge == null) return;
        WebView webView = bridge.getWebView();
        if (webView == null) return;
        // Sent now and again shortly after, in case the page was still loading the first time.
        String js = "window.__safeTopPx=" + safeTopCssPx + ";window.dispatchEvent(new Event('resize'));";
        webView.post(() -> webView.evaluateJavascript(js, null));
        webView.postDelayed(() -> webView.evaluateJavascript(js, null), 1500);
    }
}

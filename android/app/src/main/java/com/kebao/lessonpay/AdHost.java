package com.kebao.lessonpay;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * 广告位的宿主容器。
 *
 * 现在还没有接任何广告平台，因为接穿山甲/优量汇需要：AppID、广告位 ID、
 * 对应 AAR（放进 android/libs/），以及平台对应用的审核。这些都得有开发者账号才有。
 *
 * 所以这里先把「位置、尺寸、让位、开关」这层做干净：
 *   - 高度为 0 时完全不参与布局，对现有界面零影响
 *   - 开启预览时显示一个占位块，让人看清广告会出现在哪、占多大
 *   - 以后接真实 SDK，只需要把 createBanner() 换成 SDK 返回的 View，其余不用动
 */
final class AdHost {

    /** 标准 banner 320×50，加上下内边距按 56dp 算，避免被裁 */
    static final int BANNER_DP = 56;

    private final Activity act;
    private final FrameLayout box;
    private View contentView;

    private boolean preview = false;
    private String position = "";
    private int insetBottom = 0;      // 系统导航栏高度，banner 要落在它上面

    AdHost(Activity a) {
        this.act = a;

        box = new FrameLayout(a);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, Gravity.BOTTOM);
        box.setLayoutParams(lp);
        box.setBackgroundColor(Color.WHITE);
        box.setVisibility(View.GONE);
    }

    View view() {
        return box;
    }

    /** 系统导航栏高度变化时调用：banner 要跟着上移，不能压在导航栏底下 */
    void setInsetBottom(int px) {
        if (insetBottom == px) return;
        insetBottom = px;
        applyLayout();
    }

    /** 当前占用了多少高度（WebView 要让出这么多） */
    int occupiedHeight() {
        return box.getVisibility() == View.VISIBLE ? dp(BANNER_DP) : 0;
    }

    /** 是否已接入真实广告 SDK。没接的时候只能预览，不能真展示 */
    boolean sdkReady() {
        return false;
    }

    boolean isPreview() {
        return preview;
    }

    String currentPosition() {
        return position;
    }

    /**
     * 请求在某个位置展示 banner。
     * @return 是否真的显示了（没接 SDK 且没开预览时返回 false，界面就什么都不用做）
     */
    boolean show(String pos) {
        position = pos == null ? "" : pos;
        if (!sdkReady() && !preview) {
            hide();
            return false;
        }
        if (contentView == null) contentView = createBanner();
        if (box.getChildCount() == 0) {
            box.addView(contentView, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }
        box.setVisibility(View.VISIBLE);
        applyLayout();
        return true;
    }

    void hide() {
        position = "";
        box.setVisibility(View.GONE);
        applyLayout();
        // 真正接入 SDK 后，这里还要调用广告对象的 destroy()，否则会漏内存
    }

    /** 预览开关：没接 SDK 时用来确认版式和让位是否合适 */
    void setPreview(boolean on) {
        preview = on;
        if (!on && !sdkReady()) hide();
    }

    private void applyLayout() {
        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) box.getLayoutParams();
        int h = box.getVisibility() == View.VISIBLE ? dp(BANNER_DP) : 0;
        if (lp.height != h || lp.bottomMargin != insetBottom) {
            lp.height = h;
            lp.bottomMargin = insetBottom;
            box.setLayoutParams(lp);
        }
        if (act instanceof MainActivity) {
            ((MainActivity) act).onAdHeightChanged(h);
        }
    }

    /**
     * 真正的广告 View 从这里返回。
     * 接 SDK 时：初始化 → 创建 BannerAd → load → 拿到 View 后 return，其余逻辑不用改。
     */
    private View createBanner() {
        LinearLayout wrap = new LinearLayout(act);
        wrap.setOrientation(LinearLayout.VERTICAL);
        wrap.setGravity(Gravity.CENTER);
        wrap.setBackgroundColor(Color.parseColor("#F4F6FB"));

        TextView t = new TextView(act);
        t.setText("广告位预览 · 接入广告 SDK 后在这里展示");
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        t.setTextColor(Color.parseColor("#8A94A6"));
        t.setGravity(Gravity.CENTER);
        wrap.addView(t);

        // 预览块加个虚线感的内框，方便看清边界
        GradientDrawable stroke = new GradientDrawable();
        stroke.setColor(Color.TRANSPARENT);
        stroke.setStroke(dp(1), Color.parseColor("#D8DFEA"));
        wrap.setBackground(stroke);
        return wrap;
    }

    private int dp(int v) {
        return (int) (v * act.getResources().getDisplayMetrics().density + 0.5f);
    }
}

package com.androidtoolsuite.app.plugins.gacha;

import com.androidtoolsuite.app.plugin.gacha.BuildConfig;
import com.androidtoolsuite.app.plugin.model.ImportedPluginDescriptor;

import java.util.Collections;
import java.util.LinkedHashSet;

public final class GachaAnalysisPluginDescriptor {
    public static final String ID = "gacha_analysis";

    private GachaAnalysisPluginDescriptor() {
    }

    public static ImportedPluginDescriptor create() {
        LinkedHashSet<String> dependencies = new LinkedHashSet<>();
        dependencies.add("shizuku_auth");
        return new ImportedPluginDescriptor(
                ID,
                "跃迁与祈愿分析",
                "获取并本地分析原神祈愿与星穹铁道跃迁记录，支持 UIGF 导入、导出和合并。",
                BuildConfig.VERSION_NAME,
                "Android Tool Suite · Gacha Analysis",
                "1",
                "com.androidtoolsuite.app.plugins.gacha.GachaAnalysisPlugin",
                "",
                dependencies,
                Collections.emptyList()
        );
    }
}

package com.sidhilynx.fenna.crew;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CrewPushPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

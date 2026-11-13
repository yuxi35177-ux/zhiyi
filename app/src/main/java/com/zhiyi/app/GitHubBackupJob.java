package com.zhiyi.app;

import android.app.job.JobParameters;
import android.app.job.JobService;
import android.os.Handler;
import android.os.Looper;

/** Android JobScheduler may defer periodic jobs due to Doze/battery policies. */
public class GitHubBackupJob extends JobService {
    @Override public boolean onStartJob(JobParameters params) {
        new Thread(() -> {
            boolean success=GitHubBackup.runScheduled(getApplicationContext());
            new Handler(Looper.getMainLooper()).post(() -> jobFinished(params,!success));
        },"ZhiyiScheduledGitBackup").start();
        return true;
    }
    @Override public boolean onStopJob(JobParameters params) {return true;}
}

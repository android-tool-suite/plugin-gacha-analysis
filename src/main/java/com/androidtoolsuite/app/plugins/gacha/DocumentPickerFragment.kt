@file:Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")

package com.androidtoolsuite.app.plugins.gacha

import android.app.Activity
import android.app.Fragment
import android.content.Intent
import android.net.Uri
import android.os.Bundle

internal class DocumentPickerFragment : Fragment() {
    private var callback: ((Uri?) -> Unit)? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState != null) removeSelf()
    }

    fun openJson(onResult: (Uri?) -> Unit) {
        callback = onResult
        startActivityForResult(
            Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "application/json"
                putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/json", "text/json", "text/plain", "*/*"))
            },
            REQUEST_OPEN,
        )
    }

    fun createJson(fileName: String, onResult: (Uri?) -> Unit) {
        callback = onResult
        startActivityForResult(
            Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "application/json"
                putExtra(Intent.EXTRA_TITLE, fileName)
            },
            REQUEST_CREATE,
        )
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_OPEN && requestCode != REQUEST_CREATE) return
        val result = data?.data.takeIf { resultCode == Activity.RESULT_OK }
        callback?.invoke(result)
        callback = null
        removeSelf()
    }

    private fun removeSelf() {
        if (isAdded) fragmentManager?.beginTransaction()?.remove(this)?.commitAllowingStateLoss()
    }

    companion object {
        private const val TAG = "gacha-analysis-document-picker"
        private const val REQUEST_OPEN = 7401
        private const val REQUEST_CREATE = 7402

        fun attach(activity: Activity): DocumentPickerFragment {
            val manager = activity.fragmentManager
            (manager.findFragmentByTag(TAG) as? DocumentPickerFragment)?.let {
                manager.beginTransaction().remove(it).commitAllowingStateLoss()
                manager.executePendingTransactions()
            }
            val fragment = DocumentPickerFragment()
            manager.beginTransaction().add(fragment, TAG).commitAllowingStateLoss()
            manager.executePendingTransactions()
            return fragment
        }
    }
}

angular.module("JenkinsDashboard")
.controller("IndexCtrl", function($scope, $interval, $timeout, $alert, Socket, ScreenSaver, Conf, Voice) {

	var $ts = function() {
		var pad = function(n) { return ('0' + n).slice(-2); },
			date = new Date();
		return pad(date.getHours()) +':'+ pad(date.getMinutes()) +':'+ pad(date.getSeconds());
	}

	var VIEW_REFRESH_MS = 9000,
		BUILD_FAST_REFRESH_MS = 2000;

	var disconnected = true;

	$scope.pageTitle = "Jenkins dashboard";
	$scope.jobsArray = [];
	$scope.jobs = {};
	$scope.details = {};
	$scope.lastBuild = {};
	$scope.conf = Conf.val;
	$scope.views = [];

	var updateViewInterval;
	Socket.on("connect", function() {
		clearJobsTimeouts();
		$interval.cancel(updateViewInterval);
		updateViewInterval = $interval(requestUpdateView, VIEW_REFRESH_MS);
		disconnected = false;
		requestUpdateView();
	});

	Socket.on("disconnect", function() {
		disconnected = true;
		console.log($ts(), '!!! Disconnected, clearing all timeouts');
		clearJobsTimeouts();
		$interval.cancel(updateViewInterval);
	});

	Socket.on("j error", function(error) {
		var myAlert = $alert({
			title: 'Ouch!', 
			content: 'Error from Jenkins, will retry..', 
			placement: 'top',
			type: 'danger',
			container: '.alert-container',
			show: true,
			duration: VIEW_REFRESH_MS / 1000 / 2
		});
	});

	function requestUpdateView() {
		if (disconnected) { console.log($ts(), '!! Disconnected !!'); return; }
		Socket.emit("j update-view", Conf.val.viewName);
	}

	function requestUpdateJob(jobName) {
		if (disconnected) { console.log($ts(), '!! Disconnected !!'); return; }
		Socket.emit("j update-job", jobName);
	}

	function requestUpdateJobFast(jobName) {
		if (disconnected) { console.log($ts(), '!! Disconnected !!'); return; }

		console.log($ts(), '## Request update job fast ', jobName);
		Socket.emit("j update-job-fast", jobName);
	}

	function requestUpdateBuild(jobName, buildNumber) {
		if (disconnected) { console.log($ts(),'!! Disconnected !!'); return; }
		Socket.emit("j update-build", {jobName: jobName, buildNumber: buildNumber});
	}

	var buildingJobs = {},
		updateFastTimers = {};
	function requestUpdateBuildFast(jobName, buildNumber) {
		if (disconnected) { console.log($ts(),'!! Disconnected !!'); return; }

		console.log($ts(),'## Update job fast ', jobName, buildNumber);
		Socket.emit("j update-build-fast", {jobName: jobName, buildNumber: buildNumber});

		updateFastTimers[jobName + buildNumber] = $timeout(function() {
			requestUpdateBuildFast(jobName, buildNumber);
		}, BUILD_FAST_REFRESH_MS);
	}

	function clearJobsTimeouts() {
		if (Object.keys(updateFastTimers).length > 0) {
			for (var t in updateFastTimers) {
				$timeout.cancel(updateFastTimers[t]);
				delete updateFastTimers[t];
				console.log($ts(),'@@@ Cleared timer ', t);
			}
		}
	}

	$scope.orderByConfiguration = function(job) {
		switch (Conf.val.order) {
			case "running" : return orderByRunningFirst(job);
			case "broken": return orderByBrokenFirst(job);
			default : return job.name;
		}
		return orderByBrokenFirst(job);
	}

	function orderByBrokenFirst(job) {
		if (job.color === "red") {
			return 0 + job.name;
		} else if (job.color.match(/_anime/) !== null) {
			return 1 + job.name;
		} else {
			return 3 + job.name;
		}
	};

	function orderByRunningFirst(job) {
		if (job.color.match(/_anime/) !== null) {
			return 0 + job.name;
		} else if (job.color === "red") {
			return 1 + job.name;
		} else {
			return 2 + job.name;
		}
	};


	$scope.somethingBroken = false;
	Socket.on("j update-view", function(res) {
		clearJobsTimeouts();

		var somethingBuilding = false;
		$scope.somethingBroken = false;
		$scope.jobsArray = [];
		for (var j in res.jobs) {
			var job = res.jobs[j];

			if (isBuilding(job.color)) {
				requestUpdateJobFast(job.name)
				somethingBuilding = true;
				ScreenSaver.hide();
			} else {
				// View could see a job finished before we spot the 
				requestUpdateJob(job.name);
			}

			if (isBroken(job.color)) {
				ScreenSaver.hide();
				$scope.somethingBroken = true;
			}

			$scope.jobs[job.name] = job;
			$scope.jobsArray.push(job);
		}

		if (!somethingBuilding && !$scope.somethingBroken) {
			ScreenSaver.startTimer();
		}

		console.log($ts(), 'View updated');
	});

	Socket.on("j update-job", function(job) {

		// The job might not have any build ..
		if (job.lastBuild && job.lastBuild.number) {

			if (!needToUpdateBuild(job)) {
				// console.log($ts(),'Update job, build didnt change. not updating it.', job.name);
				return;
			}

			console.log($ts(),'Job updated ', job.name);
			$scope.details[job.name] = job;

			if (isBuilding(job.color)) {
				buildingJobs[job.name] = true;
				requestUpdateBuildFast(job.name, job.lastBuild.number);

			} else if (!isBuilding(job.color) && buildingJobs[job.name]) {
				console.log($ts(),'#### Job says is finished!', job.name);
				requestUpdateBuild(job.name, job.lastBuild.number);
				buildingJobs[job.name] = false;

				if (isBroken(job.color))
					speakUp(job);

			} else {
				requestUpdateBuild(job.name, job.lastBuild.number);
			}
		}
	});


	Socket.on("j update-build", function(jobName, build) {

		// Job just finished to build!
		if (build.building === false && buildingJobs[jobName]) {
			console.log($ts(),'#### Build says job is done!', jobName, build.number);
			$timeout.cancel(updateFastTimers[jobName + build.number]);
			requestUpdateJobFast(jobName);
		}

		console.log($ts(),'Build updated', jobName, build.number);
		$scope.lastBuild[jobName] = build;
	});

	function isBuilding(color) {
		return color.match(/_anime/) !== null;
	}

	function isBroken(color) {
		return color.match(/red/) !== null || color.match(/yellow/) !== null;
	}

	function needToUpdateBuild(job) {
		if (isBuilding($scope.jobs[job.name].color)) {
			return true;
		}

		if (buildingJobs[job.name]) {
			return true;
		}

		if ($scope.details[job.name] && $scope.details[job.name].lastBuild && job.lastBuild && job.lastBuild.number)
			if (job.lastBuild.number === $scope.details[job.name].lastBuild.number)
				return false;

		console.log($ts(),'Job is not building, but no build data, updating. ', job.name, job.lastBuild.number);
		return true;
	}

	var messageTemplatesCulprit = [
		"Hey, guys, {CULPRIT} just broke {JOBNAME}.. yayyy",
		"Ladies and gentleman, {JOBNAME} is broken. Say thanks to {CULPRIT}",
		"{JOBNAME} is broken. Maybe {CULPRIT} knows something about it?",
		"{JOBNAME} is RED. Let's blame {CULPRIT}",
		"Houston, we have a problem with {JOBNAME}, shall we ask {CULPRIT}?"
	];

	function getMessage(jobName, culprit) {
		var n = Math.random() * messageTemplatesCulprit.length | 0,
			message = messageTemplatesCulprit[n];
		return message.replace(/{JOBNAME}/g, jobName).replace(/{CULPRIT}/g, culprit);
	}

	function speakUp(job) {
		var lastBuild = $scope.lastBuild[job.name],
			culprit = "someone";

		if (lastBuild.culprits && lastBuild.culprits.length > 0 && lastBuild.culprits[0].fullName) {
			culprit = lastBuild.culprits[0].fullName.replace(/\./g, ' ');
		}

		Voice.speak(getMessage(job.name, culprit));
	}

});
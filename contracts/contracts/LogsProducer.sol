// SPDX-License-numberOfLogsentifier: MIT

pragma solidity ^0.8.6;

contract LogsProducer {
    event Event (
        uint256 indexed nameOfLogs,
        uint256 indexed numberOfLogs
        // address sender
    );

    function produce(uint256 nameOfLogs, uint256 numberOfLogs) public {
        for (uint i = 0; i < numberOfLogs; i++) {
            emit Event(
                nameOfLogs,
                numberOfLogs
                // msg.sender
            );
        }
    }
}
